import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, Send, RefreshCw, Bell, BellRing } from "lucide-react";
import { useI18n } from "../i18n";
import { MessageList, type SessionMessage } from "../components/session-view";
import {
  remoteSource,
  streamOutput,
  subscribeLiveTasks,
  isTaskActive,
  enablePush,
  hasPushSubscription,
  type RemoteProject,
  type RemoteTask,
} from "./data/remoteSource";

type View =
  | { kind: "projects" }
  | { kind: "tasks"; project: RemoteProject }
  | { kind: "conversation"; project: RemoteProject; task: RemoteTask };

const STATUS_COLOR: Record<string, string> = {
  running: "#4ade80",
  input_required: "#fbbf24",
  pending: "#60a5fa",
  todo: "#52525b",
  done: "#22c55e",
  failed: "#ef4444",
  cancelled: "#52525b",
  detached: "#fbbf24",
  interrupted: "#fbbf24",
};

function taskTitle(task: RemoteTask): string {
  if (task.name && task.name.trim()) return task.name;
  const p = task.prompt?.trim() ?? "";
  return p ? p.split("\n")[0] : task.id.slice(0, 8);
}

const shell: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-root)",
  color: "var(--text-primary)",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 14px",
  paddingTop: "max(12px, env(safe-area-inset-top))",
  borderBottom: "1px solid var(--border-dim)",
  flexShrink: 0,
  background: "var(--bg-shell, var(--bg-root))",
};

const backBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  flexShrink: 0,
  background: "none",
  border: "none",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const titleStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  fontSize: 15,
  fontWeight: 650,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const rowBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  width: "100%",
  textAlign: "left",
  padding: "14px 16px",
  background: "none",
  border: "none",
  borderBottom: "1px solid var(--border-dim)",
  color: "var(--text-primary)",
  cursor: "pointer",
  fontSize: 14,
};

function StatusDot({ status }: { status: string }) {
  return (
    <span
      style={{
        width: 9,
        height: 9,
        borderRadius: "50%",
        flexShrink: 0,
        background: STATUS_COLOR[status] ?? "#52525b",
      }}
    />
  );
}

export function RemoteApp() {
  const [view, setView] = useState<View>({ kind: "projects" });

  return (
    <div style={shell}>
      {view.kind === "projects" && <ProjectsView onOpen={(project) => setView({ kind: "tasks", project })} />}
      {view.kind === "tasks" && (
        <TasksView
          project={view.project}
          onBack={() => setView({ kind: "projects" })}
          onOpen={(task) => setView({ kind: "conversation", project: view.project, task })}
        />
      )}
      {view.kind === "conversation" && (
        <ConversationView
          task={view.task}
          onBack={() => setView({ kind: "tasks", project: view.project })}
        />
      )}
    </div>
  );
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fn()
      .then((d) => setData(d))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(reload, [reload]);
  return { data, error, loading, reload };
}

function ProjectsView({ onOpen }: { onOpen: (p: RemoteProject) => void }) {
  const { t } = useI18n();
  const { data, error, loading, reload } = useAsync(() => remoteSource.listProjects(), []);
  const [pushOn, setPushOn] = useState(false);

  useEffect(() => {
    hasPushSubscription().then(setPushOn);
  }, []);

  async function togglePush() {
    if (pushOn) return; // 已开启；关闭由浏览器/系统设置管理
    const r = await enablePush();
    if (r === "ok") setPushOn(true);
    else if (r === "denied") alert(t("remote.notificationsDenied"));
    else if (r === "unsupported") alert(t("remote.notificationsUnsupported"));
  }

  return (
    <>
      <div style={header}>
        <span style={titleStyle}>{t("welcome.projects")}</span>
        <button
          style={{ ...backBtn, color: pushOn ? "var(--accent, #4ade80)" : "var(--text-secondary)" }}
          onClick={togglePush}
          aria-label={pushOn ? t("remote.notificationsOn") : t("remote.enableNotifications")}
          title={pushOn ? t("remote.notificationsOn") : t("remote.enableNotifications")}
        >
          {pushOn ? <BellRing size={16} /> : <Bell size={16} />}
        </button>
        <button style={backBtn} onClick={reload} aria-label="refresh">
          <RefreshCw size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <Hint>{t("session.loading")}</Hint>}
        {error && <Hint>{error}</Hint>}
        {data?.map((p) => (
          <button key={p.id} style={rowBtn} onClick={() => onOpen(p)}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-hint)" }}>
                {p.taskCount ?? 0} · {p.runningCount ? `▶ ${p.runningCount}` : "—"}
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function TasksView({
  project,
  onBack,
  onOpen,
}: {
  project: RemoteProject;
  onBack: () => void;
  onOpen: (t: RemoteTask) => void;
}) {
  const { t } = useI18n();
  const { data, error, loading, reload } = useAsync(() => remoteSource.listTasks(project.id), [project.id]);

  // 实时：活跃任务集变化时刷新列表，让状态点跟随后端。
  useEffect(() => {
    let lastKey = "";
    return subscribeLiveTasks((liveIds) => {
      const key = liveIds.slice().sort().join(",");
      if (key !== lastKey) {
        lastKey = key;
        reload();
      }
    });
  }, [reload]);

  return (
    <>
      <div style={header}>
        <button style={backBtn} onClick={onBack} aria-label="back">
          <ChevronLeft size={20} />
        </button>
        <span style={titleStyle}>{project.name}</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <Hint>{t("session.loading")}</Hint>}
        {error && <Hint>{error}</Hint>}
        {data?.map((task) => (
          <button key={task.id} style={rowBtn} onClick={() => onOpen(task)}>
            <StatusDot status={task.status} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {taskTitle(task)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-hint)" }}>{task.agent}</div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * 实时会话：结构化消息（语义流）为主；任务活跃时叠加原始输出 live tail（即时反馈），
 * tail 停更 1.5s 后回拉 /messages 让本轮「落定」为干净结构化，并清空 tail。
 */
function useLiveConversation(task: RemoteTask) {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [liveTail, setLiveTail] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(() => {
    remoteSource
      .loadMessages(task.id)
      .then((m) => {
        setMessages(m);
        setLiveTail("");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [task.id]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setLiveTail("");
    refresh();

    // 已结束的任务不订阅实时流——浏览历史时保持干净，避免重放原始输出。
    if (!isTaskActive(task.status)) return;

    const stop = streamOutput(task.id, 0, (text) => {
      setLiveTail((prev) => (prev + text).slice(-8000)); // 限长，避免无限增长
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(refresh, 1500);
    });
    return () => {
      stop();
      clearTimeout(settleTimer.current);
    };
  }, [task.id, task.status, refresh]);

  return { messages, liveTail, loading, error };
}

function ConversationView({ task, onBack }: { task: RemoteTask; onBack: () => void }) {
  const { t } = useI18n();
  const { messages, liveTail, loading, error } = useLiveConversation(task);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  // 粘底：仅当用户已在底部附近时自动滚到底，避免上滑看历史时被拽回。
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, liveTail]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  async function send() {
    const msg = input.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await remoteSource.sendInput(task.id, msg);
      setInput("");
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div style={header}>
        <button style={backBtn} onClick={onBack} aria-label="back">
          <ChevronLeft size={20} />
        </button>
        <StatusDot status={task.status} />
        <span style={titleStyle}>{taskTitle(task)}</span>
      </div>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: "auto", padding: "16px 14px 8px" }}
      >
        {loading && <Hint>{t("session.loading")}</Hint>}
        {error && <Hint>{error}</Hint>}
        {!loading && !error && messages.length === 0 && !liveTail && (
          <Hint>{t("session.noMessages")}</Hint>
        )}
        <MessageList messages={messages} />
        {liveTail && (
          <pre
            style={{
              margin: "8px 0 0",
              padding: "8px 10px",
              fontSize: 11.5,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
              background: "var(--bg-input)",
              border: "1px solid var(--border-dim)",
              borderRadius: 6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              opacity: 0.85,
            }}
          >
            {liveTail}
          </pre>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "8px 12px",
          paddingBottom: "max(8px, env(safe-area-inset-bottom))",
          borderTop: "1px solid var(--border-dim)",
          flexShrink: 0,
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder={t("remote.messagePlaceholder")}
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--bg-input)",
            border: "1px solid var(--border-dim)",
            borderRadius: 8,
            color: "var(--text-primary)",
            fontSize: 15,
            padding: "10px 12px",
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 42,
            flexShrink: 0,
            background: "var(--accent, #4ade80)",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            cursor: "pointer",
            opacity: sending || !input.trim() ? 0.5 : 1,
          }}
          aria-label="send"
        >
          <Send size={17} />
        </button>
      </div>
    </>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "var(--text-hint)", fontSize: 13, padding: "16px" }}>{children}</div>;
}
