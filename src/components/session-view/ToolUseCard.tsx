import { useState } from "react";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";

/** 工具调用卡片——名字常显、参数折叠。纯渲染，无数据获取。 */
export function ToolUseCard({ name, input }: { name: string; input: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      style={{
        margin: "6px 0",
        border: "1px solid var(--border-dim)",
        borderRadius: 6,
        overflow: "hidden",
        fontSize: 12,
      }}
    >
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "5px 10px",
          background: "var(--bg-input)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          color: "var(--text-secondary)",
        }}
      >
        {expanded ? (
          <ChevronDown size={11} style={{ flexShrink: 0 }} />
        ) : (
          <ChevronRight size={11} style={{ flexShrink: 0 }} />
        )}
        <Wrench size={11} style={{ color: "var(--text-hint)", flexShrink: 0 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{name}</span>
      </button>
      {expanded && (
        <pre
          style={{
            margin: 0,
            padding: "8px 12px",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-secondary)",
            background: "var(--bg-root)",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {input}
        </pre>
      )}
    </div>
  );
}
