use once_cell::sync::OnceCell;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::sync::{
    atomic::{AtomicBool, AtomicU16, Ordering},
    Arc,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const DEFAULT_PORT: u16 = 9877;

/// 远程面板的前端产物（src/remote → dist-remote/，由 vite.remote.config.ts 构建）
/// 编译期嵌入二进制，由本地 HTTP 服务器提供。替代旧的手写单文件 remote_chat.html。
#[derive(rust_embed::RustEmbed)]
#[folder = "../dist-remote/"]
struct RemoteAssets;

static APP_HANDLE: OnceCell<AppHandle> = OnceCell::new();
static BOT_CONFIG: OnceCell<Mutex<Option<BotConfig>>> = OnceCell::new();
static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static CURRENT_PORT: AtomicU16 = AtomicU16::new(0);

fn shutdown_holder() -> &'static Mutex<Option<tokio::sync::oneshot::Sender<()>>> {
    static HOLDER: std::sync::OnceLock<Mutex<Option<tokio::sync::oneshot::Sender<()>>>> =
        std::sync::OnceLock::new();
    HOLDER.get_or_init(|| Mutex::new(None))
}

#[derive(Clone, Serialize, Deserialize)]
pub struct BotConfig {
    pub app_id: String,
    pub app_secret: String,
    pub port: u16,
    /// 远程面板访问令牌——所有 /api/* 请求必须携带。
    /// 旧配置文件无此字段时反序列化为空，启动时补生成并落盘。
    #[serde(default)]
    pub token: String,
}

impl BotConfig {
    fn default_port() -> Self {
        Self {
            app_id: String::new(),
            app_secret: String::new(),
            port: DEFAULT_PORT,
            token: generate_token(),
        }
    }

    fn has_feishu_credentials(&self) -> bool {
        !self.app_id.is_empty() && !self.app_secret.is_empty()
    }
}

/// 生成 64 位十六进制随机令牌（两个 UUIDv4 拼接）。复用已有 uuid 依赖，无需新增 crate。
fn generate_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

/// 常量时间比较，避免按字符提前返回造成的计时侧信道。
fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

#[derive(Serialize)]
struct TaskInfo {
    id: String,
    label: String,
}

#[derive(Serialize)]
struct OutputChunk {
    seq: u64,
    text: String,
}

#[derive(Serialize)]
struct OutputResponse {
    chunks: Vec<OutputChunk>,
    next_cursor: u64,
}

struct TokenCache {
    token: String,
    expires_at: i64,
}

// ─── Startup ─────────────────────────────────────────────────────────────────

pub fn start(app_handle: AppHandle) {
    let _ = APP_HANDLE.set(app_handle.clone());
    let _ = BOT_CONFIG.set(Mutex::new(None));

    let config_path = app_handle
        .path()
        .app_data_dir()
        .ok()
        .map(|dir| dir.join("feishu_config.json"));

    let mut cfg = match config_path.as_ref() {
        Some(path) => std::fs::read_to_string(path)
            .ok()
            .and_then(|c| serde_json::from_str::<BotConfig>(&c).ok())
            .unwrap_or_else(BotConfig::default_port),
        None => BotConfig::default_port(),
    };

    // 旧配置文件没有 token 字段（反序列化为空）→ 补生成并落盘，保证服务器有鉴权口令。
    if cfg.token.is_empty() {
        cfg.token = generate_token();
        if let Some(path) = config_path.as_ref() {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            if let Ok(s) = serde_json::to_string(&cfg) {
                let _ = std::fs::write(path, s);
            }
        }
    }

    if let Some(store) = BOT_CONFIG.get() {
        *store.lock() = Some(cfg.clone());
    }

    spawn_server(cfg);
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

fn spawn_server(cfg: BotConfig) {
    let new_port = cfg.port;
    let current_port = CURRENT_PORT.load(Ordering::SeqCst);
    let is_running = SERVER_RUNNING.load(Ordering::SeqCst);

    if is_running {
        if current_port == new_port {
            // Same port — credentials-only update, no restart needed.
            return;
        }
        // Port changed — stop the old server.
        if let Some(tx) = shutdown_holder().lock().take() {
            let _ = tx.send(());
        }
        // Wait briefly for port release (max 500 ms).
        for _ in 0..10 {
            if !SERVER_RUNNING.load(Ordering::SeqCst) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }

    CURRENT_PORT.store(new_port, Ordering::SeqCst);

    let (tx, rx) = tokio::sync::oneshot::channel::<()>();
    *shutdown_holder().lock() = Some(tx);

    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        let rt = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("[feishu] Runtime error: {}", e);
                SERVER_RUNNING.store(false, Ordering::SeqCst);
                CURRENT_PORT.store(0, Ordering::SeqCst);
                return;
            }
        };
        rt.block_on(async move { serve_http(cfg, rx).await });
        SERVER_RUNNING.store(false, Ordering::SeqCst);
        CURRENT_PORT.store(0, Ordering::SeqCst);
    });
}

async fn serve_http(cfg: BotConfig, mut shutdown: tokio::sync::oneshot::Receiver<()>) {
    let addr = format!("0.0.0.0:{}", cfg.port);
    let listener = match TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[feishu] Failed to bind {}: {}", addr, e);
            return;
        }
    };
    println!("[feishu] Remote panel: http://localhost:{}", cfg.port);

    let token_cache: Arc<Mutex<Option<TokenCache>>> = Arc::new(Mutex::new(None));

    loop {
        tokio::select! {
            accept_result = listener.accept() => {
                match accept_result {
                    Ok((stream, _)) => {
                        let tk = token_cache.clone();
                        let c = cfg.clone();
                        tokio::spawn(async move { handle_request(stream, &c, &tk).await });
                    }
                    Err(_) => continue,
                }
            }
            _ = &mut shutdown => {
                println!("[feishu] Server stopped (port {})", cfg.port);
                break;
            }
        }
    }
}

// ─── HTTP handling ────────────────────────────────────────────────────────────

/// Read a full HTTP request from the stream (header + body up to Content-Length).
async fn read_http_request(stream: &mut tokio::net::TcpStream) -> Option<(String, String, String, String)> {
    let mut raw: Vec<u8> = Vec::with_capacity(8192);
    let mut tmp = [0u8; 4096];

    // Read until we have the full header section
    loop {
        let n = stream.read(&mut tmp).await.ok()?;
        if n == 0 { return None; }
        raw.extend_from_slice(&tmp[..n]);
        // Find header-body separator
        if raw.windows(4).any(|w| w == b"\r\n\r\n") { break; }
        if raw.len() > 65536 { return None; } // sanity limit
    }

    // Split header and (partial) body at byte level
    let sep_pos = raw.windows(4).position(|w| w == b"\r\n\r\n")?;
    let header_bytes = &raw[..sep_pos];
    let mut body_bytes = raw[sep_pos + 4..].to_vec();

    let header_str = String::from_utf8_lossy(header_bytes);
    let request_line = header_str.lines().next().unwrap_or("");
    let parts: Vec<&str> = request_line.split_whitespace().collect();
    if parts.len() < 2 { return None; }

    let method = parts[0].to_string();
    let full_path = parts[1].to_string();

    // Parse Content-Length (byte-based, correct)
    const MAX_BODY: usize = 1 * 1024 * 1024; // 1 MB — reject oversized bodies
    let content_len: usize = header_str
        .lines()
        .find(|l| l.to_lowercase().starts_with("content-length:"))
        .and_then(|l| l.split_once(':').map(|(_, v)| v))
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    if content_len > MAX_BODY {
        return None; // Drop oversized request — caller returns 400/close
    }

    // Read remaining body bytes if not fully received
    while body_bytes.len() < content_len {
        let needed = content_len - body_bytes.len();
        let mut buf = vec![0u8; needed.min(8192)];
        match stream.read(&mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(n) => body_bytes.extend_from_slice(&buf[..n]),
        }
    }

    let body = String::from_utf8_lossy(&body_bytes[..content_len.min(body_bytes.len())]).into_owned();

    Some((method, full_path, body, header_str.into_owned()))
}

fn cors_headers() -> &'static str {
    "\r\nAccess-Control-Allow-Origin: *\
     \r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\
     \r\nAccess-Control-Allow-Headers: Content-Type, X-Nezha-Token, Authorization"
}

fn json_ok(data: &Value) -> String {
    let body = serde_json::to_string(data).unwrap_or_default();
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}{}\r\nConnection: close\r\n\r\n{}",
        body.len(), cors_headers(), body
    )
}

async fn handle_request(
    mut stream: tokio::net::TcpStream,
    cfg: &BotConfig,
    token_cache: &Arc<Mutex<Option<TokenCache>>>,
) {
    let (method, full_path, body, headers) = match read_http_request(&mut stream).await {
        Some(r) => r,
        None => return,
    };

    let (path, query) = match full_path.find('?') {
        Some(i) => (&full_path[..i], &full_path[i + 1..]),
        None => (full_path.as_str(), ""),
    };

    // 鉴权：所有 /api/* 必须携带正确 token（OPTIONS 预检放行；
    // 静态页 / health / feishu-webhook 不在 /api/ 下，不受此门控）。
    // token 经 ?token= 查询参数（供 SSE/扫码首跳）或 X-Nezha-Token / Authorization: Bearer 请求头传入。
    if method != "OPTIONS" && path.starts_with("/api/") && !check_auth(cfg, &headers, query) {
        let _ = stream.write_all(unauthorized().as_bytes()).await;
        return;
    }

    // SSE routes — keep connection alive, return early
    if method == "GET" {
        if let Some(task_id) = path.strip_prefix("/api/stream/") {
            if !task_id.is_empty() && is_safe_id(task_id) {
                let since: u64 = parse_qs(query, "since").and_then(|v| v.parse().ok()).unwrap_or(0);
                handle_sse_output(stream, task_id.to_string(), since).await;
                return;
            }
        }
        if path == "/api/events" {
            handle_sse_events(stream).await;
            return;
        }
    }

    // 静态资源：GET 且非 /api、非 /health → 由内嵌的远程面板 bundle 提供（含 index.html、assets/*）。
    if method == "GET" && path != "/health" && !path.starts_with("/api/") {
        let rel = if path == "/" { "index.html" } else { path.trim_start_matches('/') };
        // 防目录穿越：debug 模式下 rust-embed 从磁盘读取，`..` 可能逃逸出 dist-remote。
        if rel.contains("..") || !serve_remote_asset(&mut stream, rel).await {
            let _ = stream.write_all(not_found().as_bytes()).await;
        }
        return;
    }

    let response = match method.as_str() {
        "OPTIONS" => format!(
            "HTTP/1.1 204 No Content{}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            cors_headers()
        ),

        "GET" => match path {
            "/health" => format!(
                "HTTP/1.1 200 OK\r\nContent-Length: 2{}\r\nConnection: close\r\n\r\nOK",
                cors_headers()
            ),
            "/api/tasks" => json_ok(&json!(list_tasks_info())),
            "/api/projects" => json_ok(&json!(read_projects())),
            // Web Push：面板订阅前先取 VAPID 公钥作为 applicationServerKey。
            "/api/push/key" => json_ok(&json!({ "key": crate::push::vapid_public_b64() })),
            p if p.starts_with("/api/project/") && p.ends_with("/tasks") => {
                let pid = p.strip_prefix("/api/project/")
                    .and_then(|s| s.strip_suffix("/tasks"))
                    .unwrap_or("");
                json_ok(&json!(list_project_tasks(pid)))
            }
            p if p.starts_with("/api/output/") => {
                let task_id = &p["/api/output/".len()..];
                if !is_safe_id(task_id) {
                    not_found()
                } else {
                    let since: u64 = parse_qs(query, "since").and_then(|v| v.parse().ok()).unwrap_or(0);
                    json_ok(&json!(get_output(task_id, since)))
                }
            }
            p if p.starts_with("/api/task/") && p.ends_with("/history") => {
                let task_id = p.strip_prefix("/api/task/")
                    .and_then(|s| s.strip_suffix("/history"))
                    .unwrap_or("");
                if !is_safe_id(task_id) {
                    not_found()
                } else {
                    json_ok(&get_task_history(task_id))
                }
            }
            // 结构化会话消息（SessionMessage[]）——复用桌面同一解析器，两端契约一致。
            p if p.starts_with("/api/task/") && p.ends_with("/messages") => {
                let task_id = p.strip_prefix("/api/task/")
                    .and_then(|s| s.strip_suffix("/messages"))
                    .unwrap_or("");
                if !is_safe_id(task_id) {
                    not_found()
                } else {
                    let mut msgs = resolve_task_session_path(task_id)
                        .and_then(|path| crate::session::parse_session_messages_file(&path).ok())
                        .unwrap_or_default();
                    // 移动端只取最近 N 条，控制 HTTP 负载（完整历史在桌面查看）。
                    const MAX_REMOTE_MESSAGES: usize = 400;
                    if msgs.len() > MAX_REMOTE_MESSAGES {
                        msgs.drain(0..msgs.len() - MAX_REMOTE_MESSAGES);
                    }
                    json_ok(&json!(msgs))
                }
            }
            _ => not_found(),
        },

        "POST" => match path {
            "/api/send" => {
                let parsed: Value = serde_json::from_str(&body).unwrap_or_default();
                let task_id = parsed["task_id"].as_str().unwrap_or("");
                let result = if let Some(raw) = parsed["raw"].as_str() {
                    send_raw_to_task(task_id, raw)
                } else {
                    let msg = parsed["message"].as_str().unwrap_or("");
                    send_to_task(task_id, msg)
                };
                json_ok(&json!({"ok": true, "result": result}))
            }
            "/api/task/create" => json_ok(&create_remote_task(&body)),
            // Web Push：保存浏览器订阅（endpoint + keys.p256dh + keys.auth）。
            "/api/push/subscribe" => {
                let parsed: Value = serde_json::from_str(&body).unwrap_or_default();
                let endpoint = parsed["endpoint"].as_str().unwrap_or("").to_string();
                let p256dh = parsed["keys"]["p256dh"].as_str().unwrap_or("").to_string();
                let auth = parsed["keys"]["auth"].as_str().unwrap_or("").to_string();
                // endpoint 必须是 https 推送服务地址，避免桌面被诱导向任意 URL 发出站请求。
                if endpoint.is_empty()
                    || p256dh.is_empty()
                    || auth.is_empty()
                    || !endpoint.starts_with("https://")
                {
                    json_ok(&json!({"error": "invalid subscription"}))
                } else {
                    crate::push::add_subscription(endpoint, p256dh, auth);
                    json_ok(&json!({"ok": true}))
                }
            }
            "/feishu-webhook" => handle_feishu_webhook(&body, cfg, token_cache).await,
            _ => not_found(),
        },

        _ => not_found(),
    };

    let _ = stream.write_all(response.as_bytes()).await;
}

fn not_found() -> String {
    "HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nNot Found".to_string()
}

/// 从内嵌的远程面板 bundle 中取出 `rel` 文件并写回（含正确 Content-Type）。
/// 命中返回 true；未命中返回 false（调用方再回 404）。
async fn serve_remote_asset(stream: &mut tokio::net::TcpStream, rel: &str) -> bool {
    match RemoteAssets::get(rel) {
        Some(asset) => {
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                content_type_for(rel),
                asset.data.len()
            );
            let _ = stream.write_all(header.as_bytes()).await;
            let _ = stream.write_all(&asset.data).await;
            true
        }
        None => false,
    }
}

fn content_type_for(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".js") || path.ends_with(".mjs") {
        "application/javascript; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if path.ends_with(".webmanifest") {
        "application/manifest+json"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".woff2") {
        "font/woff2"
    } else {
        "application/octet-stream"
    }
}

fn unauthorized() -> String {
    let body = "Unauthorized";
    format!(
        "HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain{}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        cors_headers(),
        body.len(),
        body
    )
}

/// 校验请求是否携带正确的远程面板令牌。
/// 接受来源：`?token=` 查询参数、`X-Nezha-Token` 头、`Authorization: Bearer <token>` 头。
fn check_auth(cfg: &BotConfig, headers: &str, query: &str) -> bool {
    let expected = cfg.token.as_bytes();
    if expected.is_empty() {
        // 理论上不会发生（启动时已补生成）——放行以防本机被锁死。
        return true;
    }
    // 1) 查询参数 ?token=（token 为十六进制，URL 编码不会改变其内容）
    if let Some(t) = parse_qs(query, "token") {
        if ct_eq(t.as_bytes(), expected) {
            return true;
        }
    }
    // 2) 请求头 X-Nezha-Token / Authorization: Bearer
    for line in headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let name = name.trim().to_ascii_lowercase();
        let value = value.trim();
        if name == "x-nezha-token" {
            if ct_eq(value.as_bytes(), expected) {
                return true;
            }
        } else if name == "authorization" {
            if let Some(tok) = value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
            {
                if ct_eq(tok.as_bytes(), expected) {
                    return true;
                }
            }
        }
    }
    false
}

/// Returns the NeZha data directory (~/.nezha/) — same root storage.rs uses.
/// This is the ONLY correct path for reading projects/tasks.
fn nezha_data_dir() -> Option<std::path::PathBuf> {
    crate::storage::nezha_dir().ok()
}

fn parse_qs<'a>(query: &'a str, key: &str) -> Option<&'a str> {
    query.split('&').find_map(|kv| {
        let mut parts = kv.splitn(2, '=');
        if parts.next() == Some(key) { parts.next() } else { None }
    })
}

// ─── Task data ────────────────────────────────────────────────────────────────

fn list_tasks_info() -> Vec<TaskInfo> {
    let app = match APP_HANDLE.get() {
        Some(a) => a,
        None => return vec![],
    };
    let tm = app.state::<crate::TaskManager>();
    let writers = tm.pty_writers.lock();
    let labels = tm.task_labels.lock();
    writers
        .keys()
        .map(|id| {
            let label = labels.get(id).cloned().unwrap_or_else(|| id[..id.len().min(12)].to_string());
            TaskInfo { id: id.clone(), label }
        })
        .collect()
}

fn get_output(task_id: &str, since: u64) -> OutputResponse {
    let app = match APP_HANDLE.get() {
        Some(a) => a,
        None => return OutputResponse { chunks: vec![], next_cursor: since },
    };
    let tm = app.state::<crate::TaskManager>();
    let map = tm.task_output.lock();
    let Some((next_seq, buf)) = map.get(task_id) else {
        return OutputResponse { chunks: vec![], next_cursor: since };
    };
    let chunks: Vec<OutputChunk> = buf
        .iter()
        .filter(|(seq, _)| *seq >= since)
        .map(|(seq, text)| OutputChunk { seq: *seq, text: text.clone() })
        .collect();
    OutputResponse { chunks, next_cursor: *next_seq }
}

fn get_task_history(task_id: &str) -> Value {
    let app = match APP_HANDLE.get() { Some(a) => a, None => return json!({"chunks":[],"count":0}) };
    let tm = app.state::<crate::TaskManager>();

    // 1. Try in-memory ring buffer (filled during current session)
    {
        let map = tm.task_output.lock();
        if let Some((_, buf)) = map.get(task_id) {
            if !buf.is_empty() {
                let chunks: Vec<Value> = buf.iter()
                    .map(|(seq, text)| json!({"seq": seq, "text": text}))
                    .collect();
                let count = chunks.len();
                return json!({"chunks": chunks, "count": count, "source": "live"});
            }
        }
    }

    // 2. Ring buffer empty — look up session JSONL on disk
    match resolve_task_session_path(task_id) {
        Some(path) => parse_session_jsonl_as_chunks(&path),
        None => json!({"chunks": [], "count": 0}),
    }
}

/// 由 task_id 定位其会话 JSONL 文件路径（优先 Claude，回退 Codex）。
/// 供 /api/task/<id>/history（原始文本）与 /api/task/<id>/messages（结构化）共用。
fn resolve_task_session_path(task_id: &str) -> Option<String> {
    let dir = nezha_data_dir()?;
    let projects: Vec<Value> = std::fs::read_to_string(dir.join("projects.json"))
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();

    for project in &projects {
        let Some(pid) = project["id"].as_str() else {
            continue;
        };
        if !is_safe_id(pid) {
            continue;
        }
        let tasks: Vec<Value> = std::fs::read_to_string(dir.join("projects").join(pid).join("tasks.json"))
            .ok()
            .and_then(|c| serde_json::from_str(&c).ok())
            .unwrap_or_default();

        if let Some(task) = tasks.iter().find(|t| t["id"].as_str() == Some(task_id)) {
            return task["claudeSessionPath"]
                .as_str()
                .or_else(|| task["codexSessionPath"].as_str())
                .map(|s| s.to_string());
        }
    }
    None
}

/// Read a Claude Code / Codex session JSONL and return assistant text as history chunks.
/// Reads at most the last 400 KB to avoid OOM on huge sessions.
fn parse_session_jsonl_as_chunks(path: &str) -> Value {
    use std::io::{Read, Seek, SeekFrom};
    let p = std::path::Path::new(path);

    // Guard against path traversal: session files must be under the user's home directory.
    let home = match crate::platform::home_dir() {
        Some(h) => h,
        None => return json!({"chunks":[], "count":0}),
    };
    let canonical = match p.canonicalize() {
        Ok(c) => c,
        Err(_) => return json!({"chunks":[], "count":0}),
    };
    if !canonical.starts_with(&home) {
        return json!({"chunks":[], "count":0});
    }

    if !p.exists() { return json!({"chunks":[], "count":0}); }

    const MAX_BYTES: i64 = 400_000;
    let (content_bytes, was_truncated) = match std::fs::File::open(p) {
        Err(_) => return json!({"chunks":[], "count":0}),
        Ok(mut f) => {
            let size = f.seek(SeekFrom::End(0)).unwrap_or(0) as i64;
            let truncated = size > MAX_BYTES;
            if truncated {
                let _ = f.seek(SeekFrom::End(-MAX_BYTES));
            } else {
                let _ = f.seek(SeekFrom::Start(0));
            }
            let mut buf = Vec::new();
            let _ = f.read_to_end(&mut buf);
            (buf, truncated)
        }
    };

    let raw = String::from_utf8_lossy(&content_bytes);
    // When we seeked into the middle, skip the (likely partial) first line
    let text: &str = if was_truncated {
        raw.find('\n').map(|i| &raw[i + 1..]).unwrap_or(&raw)
    } else {
        &raw
    };

    let mut chunks: Vec<Value> = Vec::new();
    let mut seq = 0u64;

    for line in text.lines() {
        if line.trim().is_empty() { continue }
        let msg: Value = match serde_json::from_str(line) { Ok(v) => v, Err(_) => continue };

        // Only extract assistant text content
        if msg["type"].as_str() != Some("assistant") { continue }
        let Some(content_arr) = msg["message"]["content"].as_array() else { continue };

        for item in content_arr {
            if item["type"].as_str() != Some("text") { continue }
            if let Some(t) = item["text"].as_str() {
                let t = t.trim();
                if !t.is_empty() {
                    chunks.push(json!({"seq": seq, "text": format!("{}\n\n", t)}));
                    seq += 1;
                }
            }
        }
    }

    let count = chunks.len();
    json!({"chunks": chunks, "count": count, "source": "session"})
}

fn get_live_task_ids() -> Vec<Value> {
    let app = match APP_HANDLE.get() { Some(a) => a, None => return vec![] };
    let tm = app.state::<crate::TaskManager>();
    let (live_ids, label_map): (HashSet<String>, HashMap<String, String>) = {
        let writers = tm.pty_writers.lock();
        let labels = tm.task_labels.lock();
        (writers.keys().cloned().collect(), labels.clone())
    };
    live_ids.iter().map(|id| {
        let label = label_map.get(id).cloned().unwrap_or_else(|| id[..id.len().min(8)].to_string());
        json!({"id": id, "label": label, "status": "running"})
    }).collect()
}

fn create_remote_task(body: &str) -> Value {
    let parsed: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return json!({"error": "invalid JSON"}),
    };
    let project_id = parsed["projectId"].as_str().unwrap_or("").to_string();
    let prompt = parsed["prompt"].as_str().unwrap_or("").to_string();
    // Allowlist both fields — reject unknown values to prevent privilege escalation
    let agent = match parsed["agent"].as_str().unwrap_or("claude") {
        "codex" => "codex",
        _ => "claude",
    };
    let permission_mode = match parsed["permissionMode"].as_str().unwrap_or("ask") {
        "auto_edit" => "auto_edit",
        "full_access" => "full_access",
        _ => "ask",
    };

    if project_id.is_empty() || prompt.is_empty() {
        return json!({"error": "projectId and prompt required"});
    }
    if !is_safe_id(&project_id) {
        return json!({"error": "invalid projectId"});
    }

    let app = match APP_HANDLE.get() { Some(a) => a, None => return json!({"error": "not ready"}) };
    let dir = match nezha_data_dir() { Some(d) => d, None => return json!({"error": "no data dir"}) };

    let task_id = uuid::Uuid::new_v4().to_string();
    let created_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let task = json!({
        "id": task_id,
        "projectId": project_id,
        "prompt": prompt,
        "agent": agent,
        "permissionMode": permission_mode,
        "status": "todo",
        "createdAt": created_at,
    });

    let tasks_path = dir.join("projects").join(&project_id).join("tasks.json");
    let mut tasks: Vec<Value> = std::fs::read_to_string(&tasks_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();
    tasks.push(task.clone());
    // Atomic write: write to .tmp then rename to avoid racing with the Tauri frontend's save.
    if let Ok(s) = serde_json::to_string(&tasks) {
        let tmp_path = tasks_path.with_extension("json.tmp");
        if std::fs::write(&tmp_path, s).is_ok() {
            let _ = std::fs::rename(&tmp_path, &tasks_path);
        }
    }

    let _ = app.emit("remote:run-task", &task);
    json!({"ok": true, "taskId": task_id})
}

async fn handle_sse_output(mut stream: tokio::net::TcpStream, task_id: String, since: u64) {
    let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: keep-alive\r\n\r\n";
    if stream.write_all(headers.as_bytes()).await.is_err() { return; }

    let mut cursor = since;
    let mut poll = tokio::time::interval(std::time::Duration::from_millis(120));
    let mut keepalive = tokio::time::interval(std::time::Duration::from_secs(20));
    keepalive.tick().await; // consume immediate tick

    loop {
        tokio::select! {
            _ = poll.tick() => {
                let output = get_output(&task_id, cursor);
                if !output.chunks.is_empty() {
                    let mut payload = String::new();
                    for chunk in &output.chunks {
                        let data = serde_json::to_string(
                            &json!({"seq": chunk.seq, "text": chunk.text})
                        ).unwrap_or_default();
                        payload.push_str(&format!("id: {}\ndata: {}\n\n", chunk.seq, data));
                    }
                    if stream.write_all(payload.as_bytes()).await.is_err() { return; }
                    cursor = output.next_cursor;
                }
            }
            _ = keepalive.tick() => {
                if stream.write_all(b": ping\n\n").await.is_err() { return; }
            }
        }
    }
}

async fn handle_sse_events(mut stream: tokio::net::TcpStream) {
    let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: keep-alive\r\n\r\n";
    if stream.write_all(headers.as_bytes()).await.is_err() { return; }

    let mut poll = tokio::time::interval(std::time::Duration::from_secs(3));
    let mut keepalive = tokio::time::interval(std::time::Duration::from_secs(25));
    keepalive.tick().await;

    loop {
        tokio::select! {
            _ = poll.tick() => {
                let tasks = get_live_task_ids();
                let data = serde_json::to_string(&json!({"type":"state","tasks":tasks}))
                    .unwrap_or_default();
                let event = format!("data: {}\n\n", data);
                if stream.write_all(event.as_bytes()).await.is_err() { return; }
            }
            _ = keepalive.tick() => {
                if stream.write_all(b": ping\n\n").await.is_err() { return; }
            }
        }
    }
}

// 开机自启的注册表项（HKCU\...\Run\NeZha）改由 build-release.ps1 在构建时写入，
// 指向带版本号的新 exe。app 运行时不再写注册表，避免旧版 exe 把自启项覆盖回旧版。

fn send_to_task(task_id: &str, msg: &str) -> String {
    let app = match APP_HANDLE.get() {
        Some(a) => a,
        None => return "NeZha 未就绪".to_string(),
    };
    let tm = app.state::<crate::TaskManager>();
    let mut writers = tm.pty_writers.lock();

    // Exact match first
    if let Some(w) = writers.get_mut(task_id) {
        let _ = w.write_all(msg.as_bytes());
        let _ = w.write_all(b"\n");
        let _ = w.flush();
        return format!("✅ 已发送至 {}", short_id(task_id));
    }
    // Prefix match for shortened IDs
    if let Some((fid, w)) = writers.iter_mut().find(|(k, _)| k.starts_with(task_id)) {
        let fid = fid.clone();
        let _ = w.write_all(msg.as_bytes());
        let _ = w.write_all(b"\n");
        let _ = w.flush();
        return format!("✅ 已发送至 {}", short_id(&fid));
    }
    format!("❌ 未找到任务: {}", task_id)
}

fn send_raw_to_task(task_id: &str, raw: &str) -> String {
    let app = match APP_HANDLE.get() {
        Some(a) => a,
        None => return "NeZha 未就绪".to_string(),
    };
    let tm = app.state::<crate::TaskManager>();
    let mut writers = tm.pty_writers.lock();

    if let Some(w) = writers.get_mut(task_id) {
        let _ = w.write_all(raw.as_bytes());
        let _ = w.flush();
        return "✓".to_string();
    }
    if let Some((fid, w)) = writers.iter_mut().find(|(k, _)| k.starts_with(task_id)) {
        let fid = fid.clone();
        let _ = w.write_all(raw.as_bytes());
        let _ = w.flush();
        return format!("✓ → {}", short_id(&fid));
    }
    format!("❌ 未找到任务: {}", task_id)
}

fn cancel_task_remote(task_id: &str) -> String {
    let app = match APP_HANDLE.get() {
        Some(a) => a,
        None => return "NeZha 未就绪".to_string(),
    };
    let tm = app.state::<crate::TaskManager>();
    // Send Ctrl+C to interrupt the running AI process
    {
        let mut writers = tm.pty_writers.lock();
        // Resolve key first (immutable), then get writer (mutable) to satisfy borrow checker
        let key = if writers.contains_key(task_id) {
            Some(task_id.to_string())
        } else {
            writers.keys().find(|k| k.starts_with(task_id)).cloned()
        };
        if let Some(k) = key {
            if let Some(w) = writers.get_mut(&k) {
                let _ = w.write_all(b"\x03");
                let _ = w.flush();
            }
        }
    }
    tm.cancelled_tasks.lock().insert(task_id.to_string());
    format!("🛑 已取消 {}", short_id(task_id))
}

fn short_id(id: &str) -> &str {
    // Slice by char boundary to avoid panicking on multibyte UTF-8 input.
    match id.char_indices().nth(8) {
        Some((i, _)) => &id[..i],
        None => id,
    }
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && !id.contains('/')
        && !id.contains('\\')
        && !id.contains("..")
        && id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
}

fn read_projects() -> Vec<Value> {
    let app = match APP_HANDLE.get() { Some(a) => a, None => return vec![] };
    let dir = match nezha_data_dir() { Some(d) => d, None => return vec![] };
    let content = std::fs::read_to_string(dir.join("projects.json")).unwrap_or_default();
    let mut projects: Vec<Value> = serde_json::from_str(&content).unwrap_or_default();
    let tm = app.state::<crate::TaskManager>();

    // Collect project ids and do all I/O before acquiring the lock
    let pids: Vec<String> = projects.iter()
        .filter_map(|p| p["id"].as_str().map(str::to_string))
        .collect();
    let task_ids_per_project: Vec<Vec<String>> = pids.iter().map(|pid| {
        let tasks_content = std::fs::read_to_string(
            dir.join("projects").join(pid).join("tasks.json")
        ).unwrap_or_default();
        let tasks: Vec<Value> = serde_json::from_str(&tasks_content).unwrap_or_default();
        tasks.iter().filter_map(|t| t["id"].as_str().map(str::to_string)).collect()
    }).collect();

    // Hold lock only for the in-memory lookup
    let running_ids: std::collections::HashSet<String> = {
        let writers = tm.pty_writers.lock();
        writers.keys().cloned().collect()
    };

    for (project, task_ids) in projects.iter_mut().zip(task_ids_per_project.iter()) {
        let running = task_ids.iter().filter(|id| running_ids.contains(*id)).count();
        project["runningCount"] = Value::Number(running.into());
        project["taskCount"] = Value::Number(task_ids.len().into());
    }
    projects
}

fn list_project_tasks(project_id: &str) -> Vec<Value> {
    if !is_safe_id(project_id) { return vec![]; }
    let app = match APP_HANDLE.get() { Some(a) => a, None => return vec![] };
    let dir = match nezha_data_dir() { Some(d) => d, None => return vec![] };
    let content = std::fs::read_to_string(
        dir.join("projects").join(project_id).join("tasks.json")
    ).unwrap_or_default();
    let mut tasks: Vec<Value> = serde_json::from_str(&content).unwrap_or_default();
    let tm = app.state::<crate::TaskManager>();

    // Collect from locks quickly, then release before further processing
    let (live_ids, label_map): (std::collections::HashSet<String>, std::collections::HashMap<String, String>) = {
        let writers = tm.pty_writers.lock();
        let labels = tm.task_labels.lock();
        let live = writers.keys().cloned().collect();
        let lbls = labels.clone();
        (live, lbls)
    };

    for task in &mut tasks {
        if let Some(id) = task["id"].as_str().map(str::to_string) {
            task["isLive"] = Value::Bool(live_ids.contains(&id));
            if let Some(lbl) = label_map.get(&id) {
                task["runtimeLabel"] = Value::String(lbl.clone());
            }
        }
    }
    tasks.sort_by(|a, b| {
        let priority = |s: &str| match s {
            "input_required" => 0i32,
            "running" => 1,
            "pending" => 2,
            "todo" => 3,
            _ => 4,
        };
        let pa = priority(a["status"].as_str().unwrap_or(""));
        let pb = priority(b["status"].as_str().unwrap_or(""));
        if pa != pb { return pa.cmp(&pb); }
        let ta = a["createdAt"].as_i64().unwrap_or(0);
        let tb = b["createdAt"].as_i64().unwrap_or(0);
        tb.cmp(&ta)
    });
    tasks
}

// ─── Feishu webhook ───────────────────────────────────────────────────────────

async fn handle_feishu_webhook(
    body: &str,
    cfg: &BotConfig,
    token_cache: &Arc<Mutex<Option<TokenCache>>>,
) -> String {
    let data: Value = match serde_json::from_str(body) {
        Ok(d) => d,
        Err(_) => return json_ok(&json!({"error": "invalid json"})),
    };

    if let Some(challenge) = data.get("challenge").and_then(|c| c.as_str()) {
        return json_ok(&json!({"challenge": challenge}));
    }

    let event_type = data
        .get("header")
        .and_then(|h| h.get("event_type"))
        .and_then(|e| e.as_str());

    if event_type == Some("im.message.receive_v1") {
        let event_msg = data.get("event").and_then(|e| e.get("message"));
        let chat_id = event_msg
            .and_then(|m| m.get("chat_id"))
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let sender = data
            .get("event")
            .and_then(|e| e.get("sender"))
            .and_then(|s| s.get("sender_id"))
            .and_then(|s| s.get("open_id"))
            .and_then(|s| s.as_str())
            .unwrap_or("")
            .to_string();
        let text = event_msg
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            .and_then(|c| serde_json::from_str::<Value>(c).ok())
            .and_then(|v| v.get("text").and_then(|t| t.as_str().map(str::to_string)))
            .unwrap_or_default()
            .trim()
            .to_string();

        if !text.is_empty() && !chat_id.is_empty() && cfg.has_feishu_credentials() {
            let reply = process_feishu_command(&text, &sender);
            let cfg_owned = cfg.clone();
            let tk = token_cache.clone();
            tokio::spawn(async move {
                send_feishu_message(&chat_id, &reply, &cfg_owned, &tk).await;
            });
        }
    }

    json_ok(&json!({"code": 0}))
}

fn process_feishu_command(text: &str, _sender: &str) -> String {
    let cmd = text.trim();

    if cmd == "/help" || cmd == "help" || cmd == "帮助" {
        return "\
🤖 NeZha 飞书助手

命令列表:
/list               — 查看所有活跃任务
/send <ID> <消息>   — 向任务发送消息
/cancel <ID>        — 取消任务（发送 Ctrl+C）
/status <ID>        — 查看任务状态
/help               — 帮助
"
        .to_string();
    }

    if cmd == "/list" || cmd == "list" {
        let tasks = list_tasks_info();
        if tasks.is_empty() {
            return "暂无活跃任务".to_string();
        }
        let mut msg = format!("📋 共 {} 个活跃任务:\n\n", tasks.len());
        for t in &tasks {
            msg.push_str(&format!("🔹 `{}` — {}\n", short_id(&t.id), t.label));
        }
        msg.push_str("\n使用 /send <ID前8位> <消息> 发送输入");
        return msg;
    }

    if let Some(rest) = cmd.strip_prefix("/send ") {
        let mut parts = rest.splitn(2, |c: char| c.is_whitespace());
        let id = parts.next().unwrap_or("").trim();
        let msg = parts.next().unwrap_or("").trim();
        if id.is_empty() || msg.is_empty() {
            return "格式: /send <任务ID> <消息>".to_string();
        }
        return send_to_task(id, msg);
    }

    if let Some(id) = cmd.strip_prefix("/cancel ") {
        return cancel_task_remote(id.trim());
    }

    if let Some(id) = cmd.strip_prefix("/status ") {
        let id = id.trim();
        let app = match APP_HANDLE.get() {
            Some(a) => a,
            None => return "NeZha 未就绪".to_string(),
        };
        let tm = app.state::<crate::TaskManager>();
        let writers = tm.pty_writers.lock();
        let found = writers.contains_key(id) || writers.keys().any(|k| k.starts_with(id));
        return if found {
            format!("🔵 任务 {} 运行中", short_id(id))
        } else {
            format!("⚪ 任务 {} 未在运行", short_id(id))
        };
    }

    format!("未知命令: {}\n输入 /help 查看帮助", cmd)
}

async fn send_feishu_message(
    chat_id: &str,
    text: &str,
    cfg: &BotConfig,
    token_cache: &Arc<Mutex<Option<TokenCache>>>,
) {
    let token = match get_tenant_token(cfg, token_cache).await {
        Some(t) => t,
        None => {
            eprintln!("[feishu] Failed to get tenant token");
            return;
        }
    };
    let client = reqwest::Client::new();
    let payload = json!({
        "receive_id": chat_id,
        "msg_type": "text",
        "content": serde_json::to_string(&json!({"text": text})).unwrap_or_default(),
    });
    if let Ok(resp) = client
        .post("https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id")
        .header("Authorization", format!("Bearer {}", token))
        .json(&payload)
        .send()
        .await
    {
        if !resp.status().is_success() {
            eprintln!("[feishu] send failed: {}", resp.status());
        }
    }
}

async fn get_tenant_token(
    cfg: &BotConfig,
    cache: &Arc<Mutex<Option<TokenCache>>>,
) -> Option<String> {
    {
        let cached = cache.lock();
        if let Some(ref c) = *cached {
            if c.expires_at > chrono::Utc::now().timestamp() {
                return Some(c.token.clone());
            }
        }
    }
    let client = reqwest::Client::new();
    let data: Value = client
        .post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal")
        .json(&json!({ "app_id": cfg.app_id, "app_secret": cfg.app_secret }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let token = data["tenant_access_token"].as_str()?.to_string();
    let expire = data["expire"].as_i64().unwrap_or(7200);
    *cache.lock() = Some(TokenCache {
        token: token.clone(),
        expires_at: chrono::Utc::now().timestamp() + expire - 120,
    });
    Some(token)
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn configure_feishu_bot(
    app: tauri::AppHandle,
    app_id: String,
    app_secret: String,
    port: u16,
) -> Result<(), String> {
    // 保留已有 token，不让前端保存动作覆盖/清空它（前端不传 token）。
    let token = BOT_CONFIG
        .get()
        .and_then(|s| s.lock().as_ref().map(|c| c.token.clone()))
        .filter(|t| !t.is_empty())
        .unwrap_or_else(generate_token);
    let cfg = BotConfig { app_id, app_secret, port, token };
    let config_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("feishu_config.json");
    std::fs::write(&config_path, serde_json::to_string(&cfg).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    if let Some(store) = BOT_CONFIG.get() {
        *store.lock() = Some(cfg.clone());
    }
    spawn_server(cfg);
    Ok(())
}

#[tauri::command]
pub fn get_remote_server_port() -> u16 {
    if SERVER_RUNNING.load(Ordering::SeqCst) {
        CURRENT_PORT.load(Ordering::SeqCst)
    } else {
        0
    }
}

/// 当前远程面板访问令牌，供设置页拼出带 token 的访问链接。
#[tauri::command]
pub fn get_remote_token() -> String {
    BOT_CONFIG
        .get()
        .and_then(|s| s.lock().as_ref().map(|c| c.token.clone()))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg_with(token: &str) -> BotConfig {
        BotConfig {
            app_id: String::new(),
            app_secret: String::new(),
            port: DEFAULT_PORT,
            token: token.to_string(),
        }
    }

    #[test]
    fn ct_eq_matches_only_identical() {
        assert!(ct_eq(b"abc", b"abc"));
        assert!(ct_eq(b"", b""));
        assert!(!ct_eq(b"abc", b"abd"));
        assert!(!ct_eq(b"abc", b"abcd"));
        assert!(!ct_eq(b"", b"x"));
    }

    #[test]
    fn generate_token_is_64_hex_chars() {
        let t = generate_token();
        assert_eq!(t.len(), 64);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(generate_token(), generate_token());
    }

    #[test]
    fn auth_accepts_token_via_query() {
        let cfg = cfg_with("secret123");
        assert!(check_auth(&cfg, "", "since=0&token=secret123"));
        assert!(!check_auth(&cfg, "", "token=wrong"));
        assert!(!check_auth(&cfg, "", ""));
    }

    #[test]
    fn auth_accepts_token_via_headers() {
        let cfg = cfg_with("secret123");
        assert!(check_auth(&cfg, "X-Nezha-Token: secret123\r", ""));
        assert!(check_auth(&cfg, "Authorization: Bearer secret123\r", ""));
        assert!(check_auth(&cfg, "authorization: bearer secret123\r", ""));
        assert!(!check_auth(&cfg, "X-Nezha-Token: nope\r", ""));
    }

    #[test]
    fn auth_rejects_when_missing() {
        let cfg = cfg_with("secret123");
        assert!(!check_auth(&cfg, "Host: localhost\r", ""));
    }

    #[test]
    fn auth_fails_open_when_no_token_configured() {
        // 理论上不会发生（启动时补生成）——空 token 放行以防本机被锁死。
        let cfg = cfg_with("");
        assert!(check_auth(&cfg, "", ""));
    }

    #[test]
    fn is_safe_id_rejects_traversal() {
        assert!(is_safe_id("abc-123_DEF"));
        assert!(!is_safe_id("../etc"));
        assert!(!is_safe_id("a/b"));
        assert!(!is_safe_id("a\\b"));
        assert!(!is_safe_id(""));
    }
}
