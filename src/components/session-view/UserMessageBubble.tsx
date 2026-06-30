import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { writeClipboardText } from "../file-explorer/clipboard";

/** 相对时间格式化（毫秒）。 */
function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** 用户消息气泡——右对齐 + 悬停复制。纯渲染。 */
export function UserMessageBubble({ text, createdAt }: { text: string; createdAt?: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    writeClipboardText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <div
        style={{ maxWidth: "72%", position: "relative" }}
        className="user-message-bubble"
        onMouseEnter={(e) => {
          const btn = (e.currentTarget as HTMLElement).querySelector(
            ".copy-btn",
          ) as HTMLElement | null;
          if (btn) btn.style.opacity = "1";
        }}
        onMouseLeave={(e) => {
          const btn = (e.currentTarget as HTMLElement).querySelector(
            ".copy-btn",
          ) as HTMLElement | null;
          if (btn) btn.style.opacity = "0";
        }}
      >
        <button
          className="copy-btn"
          onClick={handleCopy}
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            opacity: 0,
            transition: "opacity 0.15s",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 2,
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <div
          style={{
            padding: "10px 16px",
            background: "var(--bg-subtle)",
            color: "var(--text-primary)",
            borderRadius: 20,
            fontSize: 13.5,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
        </div>
      </div>
      {createdAt && (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-hint)",
            marginTop: 4,
            marginRight: 8,
            opacity: 0.6,
          }}
        >
          {formatTime(createdAt)}
        </div>
      )}
    </div>
  );
}
