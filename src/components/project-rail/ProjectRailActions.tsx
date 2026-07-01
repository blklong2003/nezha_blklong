import { useState } from "react";
import { ChevronsRight, Plus } from "lucide-react";
import { useI18n } from "../../i18n";

export function ProjectRailActions({
  drawerOpen,
  onToggleDrawer,
  onOpen,
  hasHiddenProjects,
}: {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onOpen: () => void;
  hasHiddenProjects: boolean;
}) {
  const { t } = useI18n();
  const [expandHov, setExpandHov] = useState(false);
  const [addHov, setAddHov] = useState(false);

  return (
    <>
      {/* Open Project button — always visible */}
      <button
        title={t("welcome.openProject")}
        onClick={onOpen}
        onMouseEnter={() => setAddHov(true)}
        onMouseLeave={() => setAddHov(false)}
        style={{
          width: "100%",
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "0 12px",
          background: addHov ? "var(--bg-hover)" : "var(--bg-card)",
          border: "1px solid var(--border-medium)",
          borderRadius: 8,
          cursor: "pointer",
          color: addHov ? "var(--text-primary)" : "var(--text-muted)",
          transition: "background 0.12s, color 0.12s",
          fontSize: 12.5,
          fontWeight: 500,
        }}
      >
        <Plus size={15} strokeWidth={2.5} />
        <span>{t("welcome.openProject")}</span>
      </button>

      {/* Show all projects — only when hidden projects exist */}
      {hasHiddenProjects && (
        <button
          title={t("project.showAllProjects")}
          onClick={onToggleDrawer}
          onMouseEnter={() => setExpandHov(true)}
          onMouseLeave={() => setExpandHov(false)}
          style={{
            width: "100%",
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: drawerOpen ? "var(--accent-subtle)" : expandHov ? "var(--bg-hover)" : "none",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
            color: drawerOpen
              ? "var(--accent)"
              : expandHov
                ? "var(--text-muted)"
                : "var(--text-hint)",
            transition: "background 0.12s, color 0.12s",
          }}
        >
          <ChevronsRight
            size={15}
            strokeWidth={2.5}
            style={{
              transform: drawerOpen ? "rotate(180deg)" : "none",
              transition: "transform 0.18s",
            }}
          />
        </button>
      )}
    </>
  );
}
