import { useState } from "react";
import { ChevronsRight } from "lucide-react";
import { useI18n } from "../../i18n";

export function ProjectRailActions({
  drawerOpen,
  onToggleDrawer,
}: {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
}) {
  const { t } = useI18n();
  const [expandHov, setExpandHov] = useState(false);

  return (
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
        size={16}
        strokeWidth={2.5}
        style={{
          transform: drawerOpen ? "rotate(180deg)" : "none",
          transition: "transform 0.18s",
        }}
      />
    </button>
  );
}
