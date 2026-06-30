//! Web Push 发送端（RFC 8291 内容加密 + RFC 8292 VAPID），纯 RustCrypto 实现。
//! 桌面自身充当推送服务器：只需出站联网，把加密通知 POST 到订阅端点（FCM/Apple），
//! 由对方推送服务投递到手机锁屏——手机无需可被反连。负载经 E2E 加密，推送服务读不到内容。

use aes_gcm::aead::Aead;
use aes_gcm::{Aes128Gcm, KeyInit, Nonce};
use base64::Engine;
use hkdf::Hkdf;
use once_cell::sync::OnceCell;
use p256::ecdh::diffie_hellman;
use p256::elliptic_curve::sec1::ToEncodedPoint;
use p256::{PublicKey, SecretKey};
use parking_lot::Mutex;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::PathBuf;
use std::sync::OnceLock;

/// base64url（无填充）——Web Push / VAPID 全程使用。
pub(crate) fn b64url(data: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(data)
}

pub(crate) fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(s).ok()
}

/// 浏览器 pushManager.subscribe() 返回的订阅信息。
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct PushSubscription {
    pub endpoint: String,
    /// 客户端公钥（未压缩点，base64url）。
    pub p256dh: String,
    /// 客户端 auth secret（16 字节，base64url）。
    pub auth: String,
}

/// VAPID 应用服务器密钥对（P-256）。私钥 32 字节，公钥未压缩点 65 字节。
#[derive(Clone)]
pub(crate) struct VapidKeypair {
    pub secret: [u8; 32],
    pub public: Vec<u8>,
}

impl VapidKeypair {
    pub fn generate() -> Self {
        let secret = SecretKey::random(&mut rand::rngs::OsRng);
        let public = secret.public_key().to_encoded_point(false).as_bytes().to_vec();
        let mut sk = [0u8; 32];
        sk.copy_from_slice(&secret.to_bytes());
        VapidKeypair { secret: sk, public }
    }

    pub fn public_b64(&self) -> String {
        b64url(&self.public)
    }
}

/// 构造 VAPID 的 ES256 JWT（RFC 8292），用 VAPID 私钥签名。
fn vapid_jwt(kp: &VapidKeypair, audience: &str, subject: &str) -> Option<String> {
    use p256::ecdsa::{signature::Signer, Signature, SigningKey};

    let header = b64url(br#"{"typ":"JWT","alg":"ES256"}"#);
    let exp = chrono::Utc::now().timestamp() + 12 * 3600;
    let claims = serde_json::json!({ "aud": audience, "exp": exp, "sub": subject });
    let payload = b64url(serde_json::to_string(&claims).ok()?.as_bytes());
    let signing_input = format!("{header}.{payload}");

    let signing_key = SigningKey::from_slice(&kp.secret).ok()?;
    let sig: Signature = signing_key.sign(signing_input.as_bytes());
    // ES256 要求裸 r||s（64 字节），p256 的 Signature::to_bytes 正是该格式。
    Some(format!("{signing_input}.{}", b64url(&sig.to_bytes())))
}

/// HKDF-SHA256：Extract(salt, ikm) 再 Expand(info, L)。
fn hkdf(salt: &[u8], ikm: &[u8], info: &[u8], out: &mut [u8]) -> Option<()> {
    Hkdf::<Sha256>::new(Some(salt), ikm).expand(info, out).ok()
}

/// RFC 8291 aes128gcm 加密。返回可直接作为 HTTP body 的字节（含 header + 密文）。
/// `ua_public`：客户端公钥 65 字节；`auth`：客户端 auth secret 16 字节。
pub(crate) fn encrypt_payload(ua_public: &[u8], auth: &[u8], plaintext: &[u8]) -> Option<Vec<u8>> {
    let ua_point = p256::EncodedPoint::from_bytes(ua_public).ok()?;
    let ua_pk = PublicKey::from_sec1_bytes(ua_point.as_bytes()).ok()?;

    // 应用服务器临时密钥对
    let as_secret = SecretKey::random(&mut rand::rngs::OsRng);
    let as_public = as_secret.public_key().to_encoded_point(false).as_bytes().to_vec();

    // ECDH
    let shared = diffie_hellman(as_secret.to_nonzero_scalar(), ua_pk.as_affine());
    let ecdh_secret = shared.raw_secret_bytes();

    // key_info = "WebPush: info" || 0x00 || ua_public || as_public
    let mut key_info = Vec::with_capacity(14 + 65 + 65);
    key_info.extend_from_slice(b"WebPush: info\0");
    key_info.extend_from_slice(ua_public);
    key_info.extend_from_slice(&as_public);
    let mut ikm = [0u8; 32];
    hkdf(auth, ecdh_secret.as_slice(), &key_info, &mut ikm)?;

    // 随机 salt，再派生 CEK / NONCE
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    let mut cek = [0u8; 16];
    hkdf(&salt, &ikm, b"Content-Encoding: aes128gcm\0", &mut cek)?;
    let mut nonce = [0u8; 12];
    hkdf(&salt, &ikm, b"Content-Encoding: nonce\0", &mut nonce)?;

    // 单记录：明文追加 0x02（最后一条记录的填充分隔符）
    let mut record = plaintext.to_vec();
    record.push(0x02);

    let cipher = Aes128Gcm::new_from_slice(&cek).ok()?;
    let ciphertext = cipher.encrypt(Nonce::from_slice(&nonce), record.as_ref()).ok()?;

    // aes128gcm header：salt(16) || record_size(4 BE) || idlen(1) || keyid(=as_public)
    let mut body = Vec::with_capacity(16 + 4 + 1 + as_public.len() + ciphertext.len());
    body.extend_from_slice(&salt);
    body.extend_from_slice(&4096u32.to_be_bytes());
    body.push(as_public.len() as u8);
    body.extend_from_slice(&as_public);
    body.extend_from_slice(&ciphertext);
    Some(body)
}

// ── 持久化状态：VAPID 密钥对 + 订阅列表 ───────────────────────────────────────

static PUSH: OnceCell<Mutex<PushState>> = OnceCell::new();

struct PushState {
    vapid: VapidKeypair,
    subs: Vec<PushSubscription>,
    path: Option<PathBuf>,
}

#[derive(Serialize, Deserialize)]
struct PushStateFile {
    vapid_secret: String,
    vapid_public: String,
    #[serde(default)]
    subscriptions: Vec<PushSubscription>,
}

impl PushState {
    fn persist(&self) {
        let Some(path) = &self.path else { return };
        let file = PushStateFile {
            vapid_secret: b64url(&self.vapid.secret),
            vapid_public: b64url(&self.vapid.public),
            subscriptions: self.subs.clone(),
        };
        if let Ok(s) = serde_json::to_string(&file) {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(path, s);
        }
    }
}

fn load_or_generate(path: Option<PathBuf>) -> PushState {
    if let Some(p) = path.as_ref() {
        if let Ok(content) = std::fs::read_to_string(p) {
            if let Ok(file) = serde_json::from_str::<PushStateFile>(&content) {
                if let (Some(sk), Some(pk)) =
                    (b64url_decode(&file.vapid_secret), b64url_decode(&file.vapid_public))
                {
                    if sk.len() == 32 {
                        let mut secret = [0u8; 32];
                        secret.copy_from_slice(&sk);
                        return PushState {
                            vapid: VapidKeypair { secret, public: pk },
                            subs: file.subscriptions,
                            path,
                        };
                    }
                }
            }
        }
    }
    // 首次：生成 VAPID 密钥对并落盘。
    let st = PushState { vapid: VapidKeypair::generate(), subs: Vec::new(), path };
    st.persist();
    st
}

/// 启动时初始化（lib.rs setup 调用）。无数据目录时仍生成一对内存密钥，保证可用。
pub fn init(data_dir: Option<PathBuf>) {
    let path = data_dir.map(|d| d.join("push_state.json"));
    let _ = PUSH.set(Mutex::new(load_or_generate(path)));
}

/// VAPID 公钥（base64url），供面板订阅时作为 applicationServerKey。
pub fn vapid_public_b64() -> Option<String> {
    PUSH.get().map(|l| l.lock().vapid.public_b64())
}

/// 新增/更新一个浏览器订阅（按 endpoint 去重），并落盘。
pub fn add_subscription(endpoint: String, p256dh: String, auth: String) {
    if let Some(lock) = PUSH.get() {
        let mut g = lock.lock();
        g.subs.retain(|s| s.endpoint != endpoint);
        g.subs.push(PushSubscription { endpoint, p256dh, auth });
        g.persist();
    }
}

fn push_runtime() -> &'static tokio::runtime::Runtime {
    static RT: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("push runtime")
    })
}

fn http_client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(reqwest::Client::new)
}

/// 任务状态变化时的推送钩子（同步，内部异步发送）。仅对 input_required / done 推送。
/// `label` 为任务的人类可读标题。调用方应保证已去重（如 event_watcher 仅在状态变化时调用）。
/// 去重：同一 task_id 的相同状态在 10s 内只推一次。
/// 让 event_watcher（hook 路径）与 session（兜底路径）可同时调用而不重复推送。
fn should_notify(task_id: &str, status: &str) -> bool {
    use std::collections::HashMap;
    use std::time::{Duration, Instant};
    static LAST: OnceLock<Mutex<HashMap<String, (String, Instant)>>> = OnceLock::new();
    let map = LAST.get_or_init(|| Mutex::new(HashMap::new()));
    let mut m = map.lock();
    let now = Instant::now();
    // 防止无限增长：积累过多时清掉 5 分钟前的陈旧条目。
    if m.len() > 256 {
        m.retain(|_, (_, t)| now.duration_since(*t) < Duration::from_secs(300));
    }
    if let Some((s, t)) = m.get(task_id) {
        if s == status && now.duration_since(*t) < Duration::from_secs(10) {
            return false;
        }
    }
    m.insert(task_id.to_string(), (status.to_string(), now));
    true
}

pub fn on_task_status(task_id: &str, status: &str, label: Option<&str>) {
    if status != "input_required" && status != "done" {
        return;
    }
    if !should_notify(task_id, status) {
        return;
    }
    let name = label.filter(|s| !s.is_empty()).unwrap_or("任务");
    let body = match status {
        "input_required" => format!("「{name}」需要你确认"),
        "done" => format!("「{name}」已完成"),
        _ => return,
    };
    let payload = serde_json::json!({
        "title": "NeZha",
        "body": body,
        "url": "/",
        "tag": task_id,
    })
    .to_string()
    .into_bytes();
    notify_all(payload);
}

fn notify_all(payload: Vec<u8>) {
    let Some(lock) = PUSH.get() else { return };
    let (vapid, subs) = {
        let g = lock.lock();
        (g.vapid.clone(), g.subs.clone())
    };
    if subs.is_empty() {
        return;
    }
    push_runtime().spawn(async move {
        let client = http_client();
        let mut dead = Vec::new();
        for sub in &subs {
            match send_one(client, &vapid, sub, &payload).await {
                Ok(404) | Ok(410) => dead.push(sub.endpoint.clone()),
                _ => {}
            }
        }
        if !dead.is_empty() {
            if let Some(lock) = PUSH.get() {
                let mut g = lock.lock();
                g.subs.retain(|s| !dead.contains(&s.endpoint));
                g.persist();
            }
        }
    });
}

/// 向单个订阅发送一条推送。成功返回 HTTP 状态码；404/410 表示订阅失效，调用方应清理。
pub(crate) async fn send_one(
    client: &reqwest::Client,
    kp: &VapidKeypair,
    sub: &PushSubscription,
    payload: &[u8],
) -> Result<u16, String> {
    let url = reqwest::Url::parse(&sub.endpoint).map_err(|e| e.to_string())?;
    let audience = url.origin().ascii_serialization();
    let jwt = vapid_jwt(kp, &audience, "mailto:nezha@localhost").ok_or("vapid jwt failed")?;
    let ua_public = b64url_decode(&sub.p256dh).ok_or("bad p256dh")?;
    let auth = b64url_decode(&sub.auth).ok_or("bad auth")?;
    let body = encrypt_payload(&ua_public, &auth, payload).ok_or("encrypt failed")?;

    let res = client
        .post(url)
        .header("Authorization", format!("vapid t={jwt}, k={}", kp.public_b64()))
        .header("Content-Encoding", "aes128gcm")
        .header("Content-Type", "application/octet-stream")
        .header("TTL", "86400")
        .body(body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(res.status().as_u16())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vapid_keypair_has_correct_sizes() {
        let kp = VapidKeypair::generate();
        assert_eq!(kp.secret.len(), 32);
        assert_eq!(kp.public.len(), 65);
        assert_eq!(kp.public[0], 0x04);
        assert_eq!(b64url_decode(&kp.public_b64()).unwrap().len(), 65);
    }

    #[test]
    fn vapid_jwt_has_three_parts() {
        let kp = VapidKeypair::generate();
        let jwt = vapid_jwt(&kp, "https://fcm.googleapis.com", "mailto:a@b.c").unwrap();
        let parts: Vec<&str> = jwt.split('.').collect();
        assert_eq!(parts.len(), 3);
        // 签名解码为 64 字节（r||s）
        assert_eq!(b64url_decode(parts[2]).unwrap().len(), 64);
        // header 解码含 ES256
        let h = String::from_utf8(b64url_decode(parts[0]).unwrap()).unwrap();
        assert!(h.contains("ES256"));
    }

    /// 端到端：以 UA 密钥对加密，再用 UA 私钥解密，验证 ECDH/HKDF/info 串/AES-GCM 全链路正确。
    /// 跑通即说明加密结构符合 RFC 8291（浏览器侧用同样步骤解密）。
    #[test]
    fn encrypt_roundtrips_with_ua_keypair() {
        use p256::elliptic_curve::sec1::ToEncodedPoint;

        // 模拟浏览器订阅密钥
        let ua_secret = SecretKey::random(&mut rand::rngs::OsRng);
        let ua_public = ua_secret.public_key().to_encoded_point(false).as_bytes().to_vec();
        let mut auth = [0u8; 16];
        rand::rngs::OsRng.fill_bytes(&mut auth);

        let plaintext = b"{\"title\":\"NeZha\",\"body\":\"task needs you\"}";
        let body = encrypt_payload(&ua_public, &auth, plaintext).unwrap();

        // ── 解密（UA 侧步骤）──
        let salt = &body[0..16];
        let idlen = body[20] as usize;
        let as_public = &body[21..21 + idlen];
        let ciphertext = &body[21 + idlen..];

        let as_pk = PublicKey::from_sec1_bytes(as_public).unwrap();
        let shared = diffie_hellman(ua_secret.to_nonzero_scalar(), as_pk.as_affine());

        let mut key_info = Vec::new();
        key_info.extend_from_slice(b"WebPush: info\0");
        key_info.extend_from_slice(&ua_public);
        key_info.extend_from_slice(as_public);
        let mut ikm = [0u8; 32];
        hkdf(&auth, shared.raw_secret_bytes().as_slice(), &key_info, &mut ikm).unwrap();

        let mut cek = [0u8; 16];
        hkdf(salt, &ikm, b"Content-Encoding: aes128gcm\0", &mut cek).unwrap();
        let mut nonce = [0u8; 12];
        hkdf(salt, &ikm, b"Content-Encoding: nonce\0", &mut nonce).unwrap();

        let cipher = Aes128Gcm::new_from_slice(&cek).unwrap();
        let mut dec = cipher.decrypt(Nonce::from_slice(&nonce), ciphertext).unwrap();
        // 去掉末尾的 0x02 填充分隔符
        assert_eq!(dec.pop(), Some(0x02));
        assert_eq!(dec, plaintext);
    }
}
