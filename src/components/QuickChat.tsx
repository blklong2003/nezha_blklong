import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Send, Loader2, MessageSquarePlus } from "lucide-react";
import { useI18n } from "../i18n";
import { useToast } from "./Toast";

interface QuickMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

/**
 * 临时对话 (Quick Chat) — 轻量级临时对话，无需创建任务/项目。
 * 通过全局快捷键 Ctrl+Shift+K 触发。
 */
export function QuickChat({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [messages, setMessages] = useState<QuickMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 聚焦输入框
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: QuickMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      // 调用临时对话后端命令
      const result = await invoke<{ response: string; session_id: string }>(
        "quick_chat",
        {
          prompt: text,
          sessionId,
          agent: "claude",
        },
      );

      const assistantMsg: QuickMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: result.response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      if (result.session_id) setSessionId(result.session_id);
    } catch (err) {
      showToast(`Quick chat failed: ${String(err)}`, "error");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, sessionId, showToast]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: "min(680px, calc(100vw - 48px))",
          height: "min(520px, calc(100vh - 96px))",
          background: "var(--bg-card)",
          borderRadius: 14,
          boxShadow: "var(--shadow-popover)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-dim)",
          }}
        >
          <MessageSquarePlus size={16} color="var(--accent)" />
          <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            {t("quickChat.title")}
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              color: "var(--text-hint)",
            }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}
        >
          {messages.length === 0 ? (
            <div style={{ color: "var(--text-hint)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
              {t("quickChat.placeholder")}
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                style={{
                  marginBottom: 12,
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "8px 12px",
                    borderRadius: 10,
                    fontSize: 13,
                    lineHeight: 1.5,
                    background:
                      msg.role === "user"
                        ? "var(--accent)"
                        : "var(--bg-input)",
                    color:
                      msg.role === "user"
                        ? "var(--fg-on-accent)"
                        : "var(--text-primary)",
                  }}
                >
                  <div
                    style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            ))
          )}
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-hint)", fontSize: 12 }}>
              <Loader2 size={14} className="spin" style={{ animation: "spin 1s linear infinite" }} />
              <span>{t("quickChat.thinking")}</span>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border-dim)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("quickChat.inputPlaceholder")}
              rows={2}
              style={{
                flex: 1,
                resize: "none",
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--border-medium)",
                background: "var(--bg-input)",
                color: "var(--text-primary)",
                fontSize: 13,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || loading}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "none",
                background: input.trim() ? "var(--accent)" : "var(--border-medium)",
                color: input.trim() ? "var(--fg-on-accent)" : "var(--text-hint)",
                cursor: input.trim() ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
