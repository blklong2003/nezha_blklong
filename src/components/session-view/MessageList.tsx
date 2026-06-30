import type { SessionMessage } from "./types";
import { MessageBlock } from "./MessageBlock";

/** 渲染一串会话消息。纯渲染——加载/错误/空态由各端容器自行处理。 */
export function MessageList({ messages }: { messages: SessionMessage[] }) {
  return (
    <>
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} />
      ))}
    </>
  );
}
