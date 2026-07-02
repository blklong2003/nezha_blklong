import type { SessionMessage } from "./types";
import { MessageBlock } from "./MessageBlock";

interface Props {
  messages: SessionMessage[];
  onFork?: (messageIndex: number) => void;
}

/** 渲染一串会话消息。纯渲染——加载/错误/空态由各端容器自行处理。 */
export function MessageList({ messages, onFork }: Props) {
  return (
    <>
      {messages.map((msg, i) => (
        <MessageBlock key={i} message={msg} index={i} onFork={onFork} />
      ))}
    </>
  );
}
