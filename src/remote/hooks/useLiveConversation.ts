// 实时会话 hook：桌面与远程面板共用。结构化消息（语义流）为主；
// 任务活跃时叠加原始输出 live tail（即时反馈），tail 停更 1.5s 后回拉 /messages
// 让本轮「落定」为干净结构化，并清空 tail。
import { useState, useEffect, useCallback, useRef } from "react";
import { remoteSource, streamOutput, isTaskActive } from "../data/remoteSource";
import type { SessionMessage } from "../../components/session-view";

export interface UseLiveConversationResult {
  messages: SessionMessage[];
  liveTail: string;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useLiveConversation(taskId: string, taskStatus: string): UseLiveConversationResult {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [liveTail, setLiveTail] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const refresh = useCallback(() => {
    remoteSource
      .loadMessages(taskId)
      .then((m) => {
        setMessages(m);
        setLiveTail("");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [taskId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setLiveTail("");
    refresh();

    // 已结束的任务不订阅实时流——浏览历史时保持干净，避免重放原始输出。
    if (!isTaskActive(taskStatus)) return;

    const stop = streamOutput(taskId, 0, (text) => {
      setLiveTail((prev) => (prev + text).slice(-8000)); // 限长，避免无限增长
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(refresh, 1500);
    });
    return () => {
      stop();
      clearTimeout(settleTimer.current);
    };
  }, [taskId, taskStatus, refresh]);

  return { messages, liveTail, loading, error, refresh };
}
