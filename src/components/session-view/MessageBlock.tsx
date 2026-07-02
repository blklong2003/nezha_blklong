import { useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Copy, Check } from "lucide-react";
import type { SessionMessage, SessionContent } from "./types";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolUseCard } from "./ToolUseCard";
import { UserMessageBubble } from "./UserMessageBubble";
import { useI18n } from "../../i18n";

/** 相对时间格式化（毫秒）- 用于消息时间戳。 */
function formatMessageTime(ts: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return t("time.justNow");
  if (diff < 3600000) return t("time.minutesAgo", { n: Math.floor(diff / 60000) });
  if (diff < 86400000) return t("time.hoursAgo", { n: Math.floor(diff / 3600000) });
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** Markdown → 清洗后的安全 HTML。内容经远程面板对外提供，必须 sanitize 防 XSS。 */
function renderMarkdown(text: string): string {
  const html = marked(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

/** 渲染单个 content block（支持多模态）。 */
function renderContentBlock(content: SessionContent, index: number): React.ReactNode {
  switch (content.type) {
    case "image":
      if (content.source?.type === "base64") {
        return (
          <img
            key={index}
            src={`data:${content.source.media_type};base64,${content.source.data}`}
            style={{
              maxWidth: "100%",
              borderRadius: 8,
              marginTop: 8,
              marginBottom: 8,
              display: "block",
            }}
          />
        );
      }
      return null;
    case "tool_result":
      if (!content.content?.length) return null;
      return (
        <div key={index} style={{ marginTop: 4, marginBottom: 4 }}>
          {content.content.map((c, i) => renderContentBlock(c, i))}
        </div>
      );
    default:
      return null;
  }
}

/** 渲染单条会话消息（用户气泡，或 assistant 的 thinking/text/tool 组合）。纯渲染。 */
export function MessageBlock({ message }: { message: SessionMessage }) {
  const { t } = useI18n();
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
  const imageParts = message.content.filter((c) => c.type === "image");
  const toolResultParts = message.content.filter((c) => c.type === "tool_result");

  if (textParts.length === 0 && toolParts.length === 0 && thinkingParts.length === 0 && imageParts.length === 0 && toolResultParts.length === 0) return null;

  return (
    <div style={{ marginBottom: 18, position: "relative" }}>
      {thinkingParts.map((t, i) => (
        <ThinkingBlock key={`th-${i}`} thinking={t.thinking ?? ""} />
      ))}
      {textParts.map((t, i) => (
        <AssistantTextBlock key={`tx-${i}`} html={renderMarkdown(t.text ?? "")} />
      ))}
      {toolParts.map((t, i) => (
        <ToolUseCard key={`tu-${i}`} name={t.name ?? ""} input={t.input ?? ""} />
      ))}
      {imageParts.map((img, i) => renderContentBlock(img, i))}
      {toolResultParts.map((tr, i) => renderContentBlock(tr, i))}
      {message.created_at && (
        <div
          style={{
            fontSize: 10,
            color: "var(--text-hint)",
            marginTop: 6,
            opacity: 0.7,
            paddingLeft: 2,
          }}
        >
          {formatMessageTime(message.created_at, t)}
        </div>
      )}
    </div>
  );
}

function AssistantTextBlock({ html }: { html: string }) {
  const { t } = useI18n();
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
        title={copied ? t("common.copied") : t("common.copy")}
        style={{
          position: "absolute",
          top: 6,
          right: 8,
          opacity: 0,
          transition: "opacity 0.2s ease, background 0.15s ease",
          background: "var(--bg-panel, #fff)",
          border: "1px solid var(--border-dim)",
          borderRadius: 6,
          cursor: "pointer",
          padding: 4,
          color: "var(--text-muted)",
          display: "flex",
          alignItems: "center",
          zIndex: 1,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <div className="session-prose" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
