import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionMessage } from "../components/session-view/types";

/**
 * 轮询 JSONL 会话文件，实时获取最新消息。
 * 用于执行中/执行后的对话视图。
 */
export function useSessionPolling(
  sessionPath: string | null,
  intervalMs: number = 2000,
): { messages: SessionMessage[]; loading: boolean } {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef<SessionMessage[]>([]);

  useEffect(() => {
    if (!sessionPath) {
      setMessages([]);
      messagesRef.current = [];
      return;
    }

    let cancelled = false;
    let retryDelay = intervalMs;

    const load = async () => {
      if (cancelled) return;
      try {
        const msgs = await invoke<SessionMessage[]>("read_session_messages", {
          sessionPath,
        });
        if (!cancelled) {
          // 只在消息数量变化时更新，避免不必要的重渲染
          if (msgs.length !== messagesRef.current.length) {
            messagesRef.current = msgs;
            setMessages(msgs);
          }
          setLoading(false);
          retryDelay = intervalMs; // 成功后重置间隔
        }
      } catch {
        // JSONL 可能还在写入中，忽略错误，增加重试间隔
        if (!cancelled) {
          retryDelay = Math.min(retryDelay * 2, 10000);
        }
      }
    };

    setLoading(true);
    load();
    const timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionPath, intervalMs]);

  return { messages, loading };
}
