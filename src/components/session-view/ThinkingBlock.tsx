import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useI18n } from "../../i18n";

/** 思考块——默认折叠。纯渲染。 */
export function ThinkingBlock({ thinking }: { thinking: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginBottom: 6 }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: "2px 0",
          color: "var(--text-hint)",
          fontSize: 11.5,
          fontStyle: "italic",
        }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span>{t("session.thinking")}</span>
      </button>
      {expanded && (
        <div
          style={{
            padding: "6px 12px",
            fontSize: 12,
            color: "var(--text-muted)",
            fontStyle: "italic",
            borderLeft: "2px solid var(--border-dim)",
            marginLeft: 4,
            marginTop: 4,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.55,
          }}
        >
          {thinking}
        </div>
      )}
    </div>
  );
}
