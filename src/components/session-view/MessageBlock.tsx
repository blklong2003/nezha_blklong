import { useState, useCallback } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { Copy, Check } from "lucide-react";
import type { SessionMessage, SessionContent } from "./types";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolUseCard } from "./ToolUseCard";
import { UserMessageBubble } from "./UserMessageBubble";
import { useI18n } from "../../i18n";

// KaTeX 动态导入（避免 rolldown 静态打包问题）
let katexReady = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let katexModule: any = null;
const katexListeners = new Set<() => void>();

/** 通知所有监听者 KaTeX 已加载 */
function notifyKatexReady() {
  katexListeners.forEach((fn) => fn());
  katexListeners.clear();
}

// KaTeX 动态导入（避免 rolldown 静态打包问题）
import("katex").then((mod: any) => {
  katexModule = mod.default || mod;
  katexReady = true;
  notifyKatexReady();
}).catch(() => {});
import "katex/dist/katex.min.css";

/** 相对时间格式化（毫秒）- 用于消息时间戳。 */
function formatMessageTime(ts: number, t: (key: string, params?: Record<string, string | number>) => string): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return t("time.justNow");
  if (diff < 3600000) return t("time.minutesAgo", { n: Math.floor(diff / 60000) });
  if (diff < 86400000) return t("time.hoursAgo", { n: Math.floor(diff / 3600000) });
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** 渲染 LaTeX 公式（动态使用 KaTeX，未加载时回退到原文并注册重渲染）。 */
function renderMath(text: string, onReady?: () => void): string {
  if (!katexReady || !katexModule) {
    // KaTeX 未加载完成，注册回调以便加载后重新渲染
    if (onReady) katexListeners.add(onReady);
    return text;
  }
  const katex = katexModule;
  // 块级公式 $$ ... $$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => {
    try {
      return `<div class="math-block">${katex.renderToString(math.trim(), { displayMode: true, throwOnError: false })}</div>`;
    } catch {
      return `<pre class="math-error">$$${math}$$</pre>`;
    }
  });
  // 行内公式 $ ... $
  text = text.replace(/(?<!\$)\$([^\$\n]{1,200}?)\$(?!\$)/g, (_, math) => {
    try {
      return katex.renderToString(math.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return `<code class="math-error">$${math}$</code>`;
    }
  });
  return text;
}

/** Markdown → 清洗后的安全 HTML。内容经远程面板对外提供，必须 sanitize 防 XSS。 */
function renderMarkdown(text: string, onKatexReady?: () => void): string {
  const withMath = renderMath(text, onKatexReady);
  const html = marked(withMath, { async: false }) as string;
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
export function MessageBlock({
  message,
  index,
  onFork,
}: {
  message: SessionMessage;
  index: number;
  onFork?: (messageIndex: number) => void;
}) {
  const { t } = useI18n();
  // 用于触发 KaTeX 加载后的重新渲染
  const [, forceUpdate] = useState(0);
  const onKatexReady = useCallback(() => forceUpdate((n) => n + 1), []);
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
    <div className="message-block" style={{ marginBottom: 18, position: "relative" }}>
      {thinkingParts.map((t, i) => (
        <ThinkingBlock key={`th-${i}`} thinking={t.thinking ?? ""} />
      ))}
      {textParts.map((t, i) => (
        <AssistantTextBlock key={`tx-${i}`} html={renderMarkdown(t.text ?? "", onKatexReady)} />
      ))}
      {toolParts.map((t, i) => (
        <ToolUseCard key={`tu-${i}`} name={t.name ?? ""} input={t.input ?? ""} />
      ))}
      {imageParts.map((img, i) => renderContentBlock(img, i))}
      {toolResultParts.map((tr, i) => renderContentBlock(tr, i))}
      {message.created_at && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10,
            color: "var(--text-hint)",
            marginTop: 6,
            opacity: 0.7,
            paddingLeft: 2,
          }}
        >
          <span>{formatMessageTime(message.created_at, t)}</span>
          {onFork && (
            <button
              onClick={() => onFork(index)}
              title="从此前住"
              style={{
                padding: "1px 6px",
                fontSize: 10,
                border: "1px solid var(--border-dim)",
                borderRadius: 4,
                background: "transparent",
                color: "var(--text-hint)",
                cursor: "pointer",
                opacity: 0,
                transition: "opacity 0.15s",
              }}
              className="fork-btn"
            >
              ⑂ 分叉
            </button>
          )}
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
