import type { Task } from "../../types";
import { useI18n } from "../../i18n";
import { StatusIcon, statusLabelKey } from "../StatusIcon";

function formatTimeAgo(ts: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return t("time.justNow");
  if (diff < 3600000) return t("time.minutesAgo", { n: Math.floor(diff / 60000) });
  if (diff < 86400000) return t("time.hoursAgo", { n: Math.floor(diff / 3600000) });
  if (diff < 604800000) return t("time.daysAgo", { n: Math.floor(diff / 86400000) });
  return t("time.weeksAgo", { n: Math.floor(diff / 604800000) });
}

function getTaskTitle(task: Task, t: (key: string, params?: Record<string, string | number>) => string): string {
  if (task.name && task.name.trim()) return task.name;
  const p = task.prompt?.trim() ?? "";
  return p ? p.split("\n")[0].slice(0, 40) : t("timeline.untitled");
}

export function ConversationRow({
  task,
  isActive,
  onClick,
}: {
  task: Task;
  isActive: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const title = getTaskTitle(task, t);
  const time = formatTimeAgo(task.updatedAt ?? task.createdAt, t);

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 8,
        border: "none",
        background: isActive
          ? "var(--conversation-active-bg, var(--accent-subtle))"
          : "transparent",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.15s ease, transform 0.12s ease",
        position: "relative",
        transform: isActive ? "translateX(2px)" : "none",
      }}
      onMouseEnter={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLButtonElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive)
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      {/* active indicator bar */}
      {isActive && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 6,
            bottom: 6,
            width: 3,
            borderRadius: 3,
            background: "var(--conversation-active-bar, var(--accent))",
          }}
        />
      )}
      {/* status icon */}
      <StatusIcon status={task.status} />
      {/* content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: isActive ? 600 : 500,
            color: isActive ? "var(--text-primary)" : "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            lineHeight: 1.3,
          }}
        >
          {title}
          {task.starred && (
            <span style={{ marginLeft: 4, color: "var(--color-warning, #fbbf24)" }}>★</span>
          )}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: "var(--text-hint)",
            marginTop: 2,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span>{task.agent}</span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>{t(statusLabelKey(task.status as any))}</span>
          <span style={{ marginLeft: "auto" }}>{time}</span>
        </div>
      </div>
    </button>
  );
}
