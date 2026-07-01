import { useState } from "react";
import { ChevronsRight, Plus } from "lucide-react";
import { useI18n } from "../../i18n";

export function ProjectRailActions({
  drawerOpen,
  onToggleDrawer,
  onOpen,
}: {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [addHov, setAddHov] = useState(false);
  const [expandHov, setExpandHov] = useState(false);

  return (
    <>
      <button
        title={t("project.showAllProjects")}
        onClick={onToggleDrawer}
        onMouseEnter={() => setExpandHov(true)}
        onMouseLeave={() => setExpandHov(false)}
        style={{
          width: "100%",
          height: 36,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "0 12px",
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
          fontSize: 12,
        }}
      >
        <ChevronsRight
          size={14}
          strokeWidth={2.5}
          style={{
            transform: drawerOpen ? "rotate(180deg)" : "none",
            transition: "transform 0.18s",
          }}
        />
        <span>{t("welcome.projects")}</span>
      </button>

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
          fontSize: 12,
        }}
      >
        <Plus size={14} strokeWidth={2.5} />
        <span>{t("welcome.openProject")}</span>
      </button>
    </>
  );
}
