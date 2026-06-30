// 远程面板的数据源——经 HTTP /api/* 取数（手机端无 Tauri invoke）。
// 与桌面共用同一套 SessionMessage 渲染组件，差别只在「数据怎么来」这一层。
import type { Project, Task } from "../../types";
import type { SessionMessage } from "../../components/session-view";

const TOKEN_KEY = "nezha_token";

/** 首跳从 URL ?token= 取访问令牌存入 localStorage，并从地址栏抹掉。 */
export function bootstrapToken(): void {
  try {
    const u = new URL(location.href);
    const qt = u.searchParams.get("token");
    if (qt) {
      localStorage.setItem(TOKEN_KEY, qt);
      u.searchParams.delete("token");
      history.replaceState(null, "", u.pathname + (u.search || "") + (u.hash || ""));
    }
  } catch {
    /* ignore */
  }
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { "X-Nezha-Token": getToken() } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Nezha-Token": getToken() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export type RemoteProject = Project & { runningCount?: number; taskCount?: number };
export type RemoteTask = Task & { isLive?: boolean; runtimeLabel?: string };

/**
 * 会话数据源抽象。远程端为 HTTP 实现；桌面若日后统一也可加 invoke 实现，
 * 渲染层（session-view/*）对底层一无所知。
 */
export interface SessionSource {
  listProjects(): Promise<RemoteProject[]>;
  listTasks(projectId: string): Promise<RemoteTask[]>;
  loadMessages(taskId: string): Promise<SessionMessage[]>;
  sendInput(taskId: string, message: string): Promise<void>;
}

export const remoteSource: SessionSource = {
  listProjects: () => apiGet<RemoteProject[]>("/api/projects"),
  listTasks: (projectId) => apiGet<RemoteTask[]>(`/api/project/${projectId}/tasks`),
  loadMessages: (taskId) => apiGet<SessionMessage[]>(`/api/task/${taskId}/messages`),
  sendInput: async (taskId, message) => {
    await apiPost("/api/send", { task_id: taskId, message });
  },
};

// ── SSE：EventSource 不能设请求头，故 token 走查询参数（服务器 check_auth 已支持）。──

/** 订阅某任务的实时原始输出（PTY 流）。返回退订函数。EventSource 自带断线重连。 */
export function streamOutput(
  taskId: string,
  since: number,
  onChunk: (text: string, seq: number) => void,
): () => void {
  const url = `/api/stream/${taskId}?since=${since}&token=${encodeURIComponent(getToken())}`;
  const es = new EventSource(url);
  let errors = 0;
  es.onmessage = (e) => {
    errors = 0;
    try {
      const d = JSON.parse(e.data) as { seq: number; text: string };
      onChunk(d.text, d.seq);
    } catch {
      /* ignore malformed frame */
    }
  };
  // 连续失败（如 401/服务器不可达）放弃，避免 EventSource 无限重连。
  es.onerror = () => {
    if (++errors >= 5) es.close();
  };
  return () => es.close();
}

/** 订阅全局活跃任务集（每 ~3s 一次），用于实时刷新任务状态。返回退订函数。 */
export function subscribeLiveTasks(onLive: (liveTaskIds: string[]) => void): () => void {
  const url = `/api/events?token=${encodeURIComponent(getToken())}`;
  const es = new EventSource(url);
  let errors = 0;
  es.onmessage = (e) => {
    errors = 0;
    try {
      const d = JSON.parse(e.data) as { type: string; tasks?: { id: string }[] };
      if (d.type === "state") onLive((d.tasks ?? []).map((tk) => tk.id));
    } catch {
      /* ignore */
    }
  };
  es.onerror = () => {
    if (++errors >= 5) es.close();
  };
  return () => es.close();
}

// ── Web Push 订阅 ─────────────────────────────────────────────────────────────

function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return buf;
}

export type PushResult = "ok" | "denied" | "unsupported" | "error";

/** 申请通知权限并向桌面注册推送订阅。iOS 需先「添加到主屏」并以 PWA 打开。 */
export async function enablePush(): Promise<PushResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return "unsupported";
  }
  let perm: NotificationPermission;
  try {
    perm = await Notification.requestPermission();
  } catch {
    return "error";
  }
  if (perm !== "granted") return "denied";
  try {
    const reg = await navigator.serviceWorker.ready;
    const { key } = await apiGet<{ key: string | null }>("/api/push/key");
    if (!key) return "error";
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToBuffer(key),
    });
    await apiPost("/api/push/subscribe", sub.toJSON());
    return "ok";
  } catch {
    return "error";
  }
}

/** 当前是否已存在推送订阅（用于显示开关状态）。 */
export async function hasPushSubscription(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}

const ACTIVE_STATUSES = new Set([
  "running",
  "pending",
  "input_required",
  "detached",
  "interrupted",
]);

export function isTaskActive(status: string): boolean {
  return ACTIVE_STATUSES.has(status);
}
