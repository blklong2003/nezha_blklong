import { marked } from "marked";
import DOMPurify from "dompurify";
import type { SessionMessage } from "./types";
import { ThinkingBlock } from "./ThinkingBlock";
import { ToolUseCard } from "./ToolUseCard";
import { UserMessageBubble } from "./UserMessageBubble";

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
    return <UserMessageBubble text={text} />;
  }

  const textParts = message.content.filter((c) => c.type === "text");
  const toolParts = message.content.filter((c) => c.type === "tool_use");
  const thinkingParts = message.content.filter((c) => c.type === "thinking");

  if (textParts.length === 0 && toolParts.length === 0 && thinkingParts.length === 0) return null;

  return (
    <div style={{ marginBottom: 18 }}>
      {thinkingParts.map((t, i) => (
        <ThinkingBlock key={i} thinking={t.thinking ?? ""} />
      ))}
      {textParts.map((t, i) => (
        <div
          key={i}
          className="session-prose"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(t.text ?? "") }}
        />
      ))}
      {toolParts.map((t, i) => (
        <ToolUseCard key={i} name={t.name ?? ""} input={t.input ?? ""} />
      ))}
    </div>
  );
}
