import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Copy, Check } from "lucide-react";
import type { SessionMessage } from "./types";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolUseCard } from "./ToolUseCard";
import { UserMessageBubble } from "./UserMessageBubble";

/** 相对时间格式化（毫秒）。 */
function formatTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** Markdown → 清洗后的安全 HTML。内容经远程面板对外提供，必须 sanitize 防 XSS。 */
function renderMarkdown(text: string): string {
  const html = marked(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

/** 渲染单条会话消息（用户气泡，或 assistant 的 thinking/text/tool 组合）。纯渲染。 */
export function MessageBlock({ message }: { message: SessionMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    const text = message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    if (!text.trim()) return null;
    return <UserMessageBubble text={text} createdAt={message.created_at} />;
  }

  const textParts = message.content.filter((c) => c.type === "text");
  const toolParts = message.content.filter((c) => c.type === "tool_use");
  const thinkingParts = message.content.filter((c) => c.type === "thinking");

  if (textParts.length === 0 && toolParts.length === 0 && thinkingParts.length === 0) return null;

  return (
    <div style={{ marginBottom: 18, position: "relative" }}>
      {thinkingParts.map((t, i) => (
        <ThinkingBlock key={i} thinking={t.thinking ?? ""} />
      ))}
      {textParts.map((t, i) => (
        <AssistantTextBlock key={i} html={renderMarkdown(t.text ?? "")} />
      ))}
      {toolParts.map((t, i) => (
        <ToolUseCard key={i} name={t.name ?? ""} input={t.input ?? ""} />
      ))}
      {message.created_at && (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-hint)",
            marginTop: 4,
            opacity: 0.6,
          }}
        >
          {formatTime(message.created_at)}
        </div>
      )}
    </div>
  );
}

function AssistantTextBlock({ html }: { html: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = html.replace(/<[^>]+>/g, "");
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={(e) => {
        const btn = (e.currentTarget as HTMLElement).querySelector(".copy-btn-asm") as HTMLElement | null;
        if (btn) btn.style.opacity = "1";
      }}
      onMouseLeave={(e) => {
        const btn = (e.currentTarget as HTMLElement).querySelector(".copy-btn-asm") as HTMLElement | null;
        if (btn) btn.style.opacity = "0";
      }}
    >
      <button
        className="copy-btn-asm"
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
          zIndex: 1,
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <div className="session-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
