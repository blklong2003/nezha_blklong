import { useState } from "react";
import { X } from "lucide-react";
import type { TaskNotification, TaskNotificationAction } from "../../types";
import { useI18n } from "../../i18n";

const ICON_MAP: Record<string, string> = {
  task_done: "✅",
  task_failed: "❌",
  task_input_required: "⚠️",
  task_cancelled: "⊘",
  worktree_merged: "🔀",
  worktree_failed: "⚠️",
};

interface Props {
  notification: TaskNotification;
  onAction: (action: TaskNotificationAction) => void;
  onDismiss: () => void;
}

export function NotificationRow({ notification, onAction, onDismiss }: Props) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);

  const isAttention = notification.level === "needs_attention";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px 4px 36px",
        marginBottom: 2,
        borderRadius: 6,
        background: isAttention
          ? "color-mix(in srgb, var(--warning) 10%, transparent)"
          : "color-mix(in srgb, var(--text-hint) 5%, transparent)",
        borderLeft: isAttention
          ? "2px solid var(--warning)"
          : "2px solid transparent",
        fontSize: 11.5,
        color: "var(--text-secondary)",
        transition: "background 0.15s ease",
        animation: isAttention ? "notif-pulse 2s ease-in-out 3" : undefined,
      }}
    >
      <span style={{ flexShrink: 0 }}>{ICON_MAP[notification.type] ?? "●"}</span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {notification.title} · {formatRelativeTime(notification.createdAt)}
      </span>
      {notification.actions.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {notification.actions.map((action) => (
            <button
              key={action}
              onClick={(e) => {
                e.stopPropagation();
                onAction(action);
              }}
              style={{
                padding: "1px 6px",
                fontSize: 10.5,
                border: "1px solid var(--border-dim)",
                borderRadius: 4,
                background: "var(--bg-card)",
                color: "var(--text-muted)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {actionLabel(action, t)}
            </button>
          ))}
        </div>
      )}
      {hovered && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          style={{
            padding: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-hint)",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function actionLabel(
  action: TaskNotificationAction,
  t: (k: string) => string,
): string {
  const labels: Record<TaskNotificationAction, string> = {
    view_diff: t("notification.action.viewDiff"),
    view_session: t("notification.action.viewSession"),
    resume: t("notification.action.resume"),
    navigate: t("notification.action.navigate"),
    retry: t("notification.action.retry"),
  };
  return labels[action] ?? action;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
  return new Date(ts).toLocaleDateString();
}
