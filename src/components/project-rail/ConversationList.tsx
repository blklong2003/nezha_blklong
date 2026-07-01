import { useState, useMemo } from "react";
import { Search, Plus } from "lucide-react";
import type { Task } from "../../types";
import { useI18n } from "../../i18n";
import s from "../../styles";
import { ConversationRow } from "./ConversationRow";

export function ConversationList({
  tasks,
  activeTaskId,
  onSelectTask,
  onNewTask,
}: {
  tasks: Task[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onNewTask: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const sorted = [...tasks].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    if (!query.trim()) return sorted;
    const q = query.toLowerCase();
    return sorted.filter((task) => {
      const title = (task.name ?? task.prompt).toLowerCase();
      return title.includes(q) || task.agent.includes(q);
    });
  }, [tasks, query]);

  return (
    <div
      style={{
        width: 200,
        flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border-dim)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Search + New */}
      <div
        style={{
          padding: "8px 8px 6px",
          borderBottom: "1px solid var(--border-dim)",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <div
          style={{
            ...s.panelSearchWrap,
            flex: 1,
            margin: 0,
            padding: "0 6px",
          }}
        >
          <Search size={12} strokeWidth={2} color="var(--text-muted)" style={{ flexShrink: 0 }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("conversation.search")}
            style={{ ...s.panelSearchInput, minWidth: 0, fontSize: 12 }}
          />
        </div>
        <button
          onClick={onNewTask}
          title={t("conversation.new")}
          style={{
            ...s.sidebarIconBtn,
            opacity: 1,
            width: 28,
            height: 28,
            background: "var(--accent-subtle)",
          }}
        >
          <Plus size={14} strokeWidth={2.5} color="var(--accent)" />
        </button>
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 4px 8px" }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: "24px 8px",
              textAlign: "center",
              color: "var(--text-hint)",
              fontSize: 11.5,
              lineHeight: 1.5,
            }}
          >
            {tasks.length === 0
              ? t("conversation.empty")
              : t("welcome.noMatchingProjects")}
          </div>
        )}
        {filtered.map((task) => (
          <ConversationRow
            key={task.id}
            task={task}
            isActive={task.id === activeTaskId}
            onClick={() => onSelectTask(task.id)}
          />
        ))}
      </div>
    </div>
  );
}
