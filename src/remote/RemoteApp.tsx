import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, Send, RefreshCw, Bell, BellRing, ArrowDown } from "lucide-react";
import { useI18n } from "../i18n";
import { MessageList } from "../components/session-view";
import {
  remoteSource,
  subscribeLiveTasks,
  enablePush,
  hasPushSubscription,
  type RemoteProject,
  type RemoteTask,
} from "./data/remoteSource";
import { useLiveConversation } from "./hooks/useLiveConversation";
import { useConversationDraft } from "./hooks/useConversationDraft";

type View =
  | { kind: "projects" }
  | { kind: "tasks"; project: RemoteProject }
  | { kind: "conversation"; project: RemoteProject; task: RemoteTask };

const STATUS_ICON: Record<string, string> = {
  running: "▶",
  pending: "◐",
  input_required: "⚠",
  detached: "⊘",
  interrupted: "⚠",
  done: "✓",
  failed: "✕",
  cancelled: "○",
  todo: "○",
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
        width: 14,
        height: 14,
        fontSize: 11,
        lineHeight: "14px",
        textAlign: "center",
        flexShrink: 0,
      }}
      title={status}
    >
      {STATUS_ICON[status] ?? "○"}
    </span>
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
        {!loading && !error && data?.length === 0 && (
          <Hint>{t("conversation.empty")}</Hint>
        )}
        {data?.map((task) => (
          <button key={task.id} style={rowBtn} onClick={() => onOpen(task)}>
            <StatusDot status={task.status} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {taskTitle(task)}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-hint)", display: "flex", gap: 4, alignItems: "center" }}>
                <span>{task.agent}</span>
                <span>·</span>
                <span>{t(`conversation.status.${task.status}`)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

function ConversationView({ task, onBack }: { task: RemoteTask; onBack: () => void }) {
  const { t } = useI18n();
  const { messages, liveTail, loading, error, refresh } = useLiveConversation(task.id, task.status);
  const { input, onChange, clear } = useConversationDraft(task.id);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [newCount, setNewCount] = useState(0);
  const prevMessageLen = useRef(0);
  const [connStatus, setConnStatus] = useState<"connected" | "disconnected">("connected");

  // 粘底：仅当用户已在底部附近时自动滚到底，避免上滑看历史时被拽回。
  // 同时跟踪新消息数量（用户已上滑时显示「↓ N 条新消息」浮标）。
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
      setNewCount(0);
    } else {
      const added = messages.length - prevMessageLen.current;
      if (added > 0) setNewCount((c) => c + added);
    }
    prevMessageLen.current = messages.length;
  }, [messages, liveTail]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) setNewCount(0);
    stickRef.current = atBottom;
  }

  function scrollToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setNewCount(0);
  }

  async function send() {
    const msg = input.trim();
    if (!msg || sending) return;
    setSending(true);
    try {
      await remoteSource.sendInput(task.id, msg);
      clear();
      scrollToBottom();
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }}>
      <div style={header}>
        <button style={backBtn} onClick={onBack} aria-label="back">
          <ChevronLeft size={20} />
        </button>
        <StatusDot status={task.status} />
        <span style={titleStyle}>{taskTitle(task)}</span>
        {connStatus === "disconnected" && (
          <button
            style={{ ...backBtn, color: "#ef4444", fontSize: 11, width: "auto", padding: "0 4px" }}
            onClick={() => { refresh(); setConnStatus("connected"); }}
            title="Reconnect"
          >
            ●
          </button>
        )}
      </div>
      {connStatus === "disconnected" && (
        <div
          style={{
            padding: "6px 14px",
            fontSize: 11,
            color: "#fff",
            background: "#ef4444",
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {t("session.unableToLoad", { error: "Connection lost" })}
          {" · "}
          <button
            onClick={() => { refresh(); setConnStatus("connected"); }}
            style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", textDecoration: "underline" }}
          >
            Retry
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ flex: 1, overflowY: "auto", padding: "16px 14px 8px", position: "relative" }}
      >
        {loading && <Hint>{t("session.loading")}</Hint>}
        {error && <Hint>{error}</Hint>}
        {!loading && !error && messages.length === 0 && !liveTail && (
          <Hint>{t("session.noMessages")}</Hint>
        )}
        <MessageList messages={messages} />
        {liveTail && (
          <div
            style={{
              margin: "8px 0 0",
              padding: "10px 12px",
              fontSize: 12,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
              background: "var(--bg-input)",
              border: "1px solid var(--border-dim)",
              borderRadius: 8,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              opacity: 0.9,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              transition: "opacity 0.2s ease",
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 4 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent, #4ade80)",
                  animation: "nezha-pulse 1.5s ease-in-out infinite",
                  boxShadow: "0 0 6px var(--accent, #4ade80)",
                }}
              />
            </span>
            <span style={{ flex: 1, lineHeight: 1.5 }}>{liveTail}</span>
          </div>
        )}
      </div>
      {newCount > 0 && (
        <button
          onClick={scrollToBottom}
          style={{
            position: "absolute",
            bottom: 70,
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 14px",
            borderRadius: 20,
            background: "var(--accent, #4ade80)",
            color: "#fff",
            border: "none",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
            zIndex: 10,
          }}
        >
          <ArrowDown size={14} />
          {newCount} new
        </button>
      )}
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
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={t("remote.messagePlaceholder")}
          style={{
            flex: 1,
            minWidth: 0,
            background: "var(--bg-input)",
            border: "1px solid var(--border-dim)",
            borderRadius: 12,
            color: "var(--text-primary)",
            fontSize: 16,
            padding: "10px 14px",
            outline: "none",
            transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--accent, #4ade80)";
            e.currentTarget.style.boxShadow = "0 0 0 3px color-mix(in srgb, var(--accent, #4ade80) 20%, transparent)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--border-dim)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 44,
            height: 44,
            flexShrink: 0,
            background: sending || !input.trim() ? "var(--bg-input)" : "var(--accent, #4ade80)",
            border: "none",
            borderRadius: 12,
            color: sending || !input.trim() ? "var(--text-hint)" : "#fff",
            cursor: sending || !input.trim() ? "default" : "pointer",
            transition: "background 0.15s ease, color 0.15s ease, transform 0.1s ease",
            transform: sending ? "scale(0.95)" : "scale(1)",
          }}
          aria-label="send"
        >
          <Send size={17} />
        </button>
      </div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ color: "var(--text-hint)", fontSize: 13, padding: "16px" }}>{children}</div>;
}
