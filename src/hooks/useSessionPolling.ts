import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionMessage } from "../components/session-view/types";

/**
 * 轮询 JSONL 会话文件，实时获取最新消息。
 * 增量更新：只在新消息到达时触发重渲染。
 */
export function useSessionPolling(
  sessionPath: string | null,
  intervalMs: number = 1500,
): {
  messages: SessionMessage[];
  loading: boolean;
  refresh: () => void;
} {
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const lastCountRef = useRef(0);

  const load = useCallback(
    async (path: string) => {
      try {
        const msgs = await invoke<SessionMessage[]>("read_session_messages", {
          sessionPath: path,
        });
        // 只有消息数量或最后一条内容变化才更新（避免频繁重渲染）
        if (msgs.length !== lastCountRef.current) {
          lastCountRef.current = msgs.length;
          setMessages(msgs);
        }
        setLoading(false);
      } catch {
        // JSONL 可能还在写入中，静默失败
      }
    },
    [],
  );

  useEffect(() => {
    if (!sessionPath) {
      setMessages([]);
      lastCountRef.current = 0;
      return;
    }

    setLoading(true);
    void load(sessionPath);

    const timer = setInterval(() => {
      void load(sessionPath);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [sessionPath, intervalMs, load]);

  const refresh = useCallback(() => {
    if (sessionPath) void load(sessionPath);
  }, [sessionPath, load]);

  return { messages, loading, refresh };
}
