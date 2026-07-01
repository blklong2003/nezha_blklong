// 会话输入暂存：按任务 ID 将未发送的输入缓存到 localStorage，
// 用户切换任务 / 刷新页面后恢复；发送成功后自动清除。
import { useState, useEffect, useRef, useCallback } from "react";

const PREFIX = "nezha:cq:"; // nezha conversation quick-stash

function loadDraft(taskId: string): string {
  try {
    return localStorage.getItem(PREFIX + taskId) ?? "";
  } catch {
    return "";
  }
}

function saveDraft(taskId: string, text: string): void {
  try {
    if (text.trim()) {
      localStorage.setItem(PREFIX + taskId, text);
    } else {
      localStorage.removeItem(PREFIX + taskId);
    }
  } catch {
    /* ignore quota / privacy mode */
  }
}

function clearDraft(taskId: string): void {
  try {
    localStorage.removeItem(PREFIX + taskId);
  } catch {
    /* ignore */
  }
}

export function useConversationDraft(taskId: string) {
  const [input, setInput] = useState(() => loadDraft(taskId));
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const taskIdRef = useRef(taskId);

  // 切换任务时加载新草稿
  useEffect(() => {
    taskIdRef.current = taskId;
    setInput(loadDraft(taskId));
  }, [taskId]);

  // 防抖写入（300ms）
  const onChange = useCallback(
    (text: string) => {
      setInput(text);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        saveDraft(taskIdRef.current, text);
      }, 300);
    },
    [],
  );

  // 发送成功后清除
  const clear = useCallback(() => {
    clearDraft(taskIdRef.current);
    setInput("");
  }, []);

  // 卸载时确保当前内容已保存
  useEffect(() => {
    return () => {
      clearTimeout(timerRef.current);
      saveDraft(taskIdRef.current, input);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { input, onChange, setInput, clear };
}

/** 清理所有会话暂存（可在设置中调用）。 */
export function clearAllConversationDrafts(): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
