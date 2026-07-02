import { invoke } from "@tauri-apps/api/core";
import { Search, TerminalSquare, FileText, Settings, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useI18n } from "../../i18n";
import {
  commandPaletteModeForInput,
  moveCommandPaletteSelection,
  rankCommandPaletteItems,
} from "./commandPaletteState";
import type { CommandPaletteCommand, CommandPaletteItem } from "./types";

const QUICK_OPEN_LIMIT = 50;
const DEBOUNCE_MS = 120;

interface FileSearchResult {
  path: string;
  name: string;
  dir: string;
}

type CommandPaletteResult =
  | (CommandPaletteItem & { command: CommandPaletteCommand })
  | (CommandPaletteItem & { filePath: string; dir: string });

export function CommandPalette({
  projectPath,
  initialInput = "",
  commands,
  onOpenFile,
  onClose,
}: {
  projectPath: string;
  initialInput?: string;
  commands: CommandPaletteCommand[];
  onOpenFile: (path: string, name: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [input, setInput] = useState(initialInput);
  const [files, setFiles] = useState<FileSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const requestIdRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = commandPaletteModeForInput(input);

  useEffect(() => {
    setActiveIndex(0);
  }, [parsed.mode, parsed.query]);

  useEffect(() => {
    if (parsed.mode !== "file") return;
    const query = parsed.query.trim();
    if (!query) {
      setFiles([]);
      setLoading(false);
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setLoading(true);

    const timer = window.setTimeout(() => {
      invoke<FileSearchResult[]>("search_project_files", {
        projectPath,
        query,
        extensions: [],
        limit: QUICK_OPEN_LIMIT,
      })
        .then((results) => {
          if (requestId === requestIdRef.current) setFiles(results);
        })
        .catch(() => {
          if (requestId === requestIdRef.current) setFiles([]);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [parsed.mode, parsed.query, projectPath]);

  const results: CommandPaletteResult[] = useMemo(() => {
    const commandItems: CommandPaletteResult[] = commands.map((command) => ({
      id: command.id,
      title: command.title,
      subtitle: command.subtitle,
      kind: "command",
      keywords: command.keywords,
      command,
    }));
    const fileItems: CommandPaletteResult[] = files.map((file) => ({
      id: file.path,
      title: file.name,
      subtitle: file.dir,
      kind: "file",
      filePath: file.path,
      dir: file.dir,
    }));
    return rankCommandPaletteItems(
      [...commandItems, ...fileItems],
      parsed.query,
      parsed.mode,
    ) as CommandPaletteResult[];
  }, [commands, files, parsed.query, parsed.mode]);

  const executeResult = (result: CommandPaletteResult | undefined) => {
    if (!result) return;
    if ("command" in result && result.command) {
      result.command.run();
    } else if ("filePath" in result && result.filePath) {
      onOpenFile(result.filePath, result.title);
    }
    onClose();
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const modeIcon =
    parsed.mode === "command" ? (
      <TerminalSquare size={15} color="var(--text-hint)" />
    ) : (
      <Search size={15} color="var(--text-hint)" />
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "var(--overlay-bg)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "calc(12vh + 20px)",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(620px, calc(100vw - 48px))",
          maxHeight: "min(480px, calc(100vh - 200px))",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border-medium)",
          borderRadius: "var(--radius-lg)",
          background: "var(--bg-card)",
          boxShadow: "var(--shadow-command-palette)",
          overflow: "hidden",
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div
          style={{
            height: 48,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 14px",
            borderBottom: "1px solid var(--border-dim)",
            flexShrink: 0,
          }}
        >
          <span style={{ display: "flex", color: "var(--text-hint)" }}>
            {loading ? (
              <Loader2 size={15} className="spin" style={{ animation: "spin 1s linear infinite" }} />
            ) : (
              modeIcon
            )}
          </span>
          <input
            ref={inputRef}
            autoFocus
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => moveCommandPaletteSelection(index, 1, results.length));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => moveCommandPaletteSelection(index, -1, results.length));
              } else if (event.key === "Enter") {
                event.preventDefault();
                executeResult(results[activeIndex]);
              } else if (event.key === "Tab") {
                event.preventDefault();
                setInput(parsed.mode === "command" ? "" : "> ");
              }
            }}
            placeholder={
              parsed.mode === "command"
                ? t("commandPalette.commandPlaceholder")
                : t("commandPalette.placeholder")
            }
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "var(--text-primary)",
              fontSize: 14,
            }}
          />
          <span
            style={{
              fontSize: 10,
              color: "var(--text-hint)",
              padding: "2px 6px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-subtle)",
              flexShrink: 0,
            }}
          >
            {parsed.mode === "command" ? ">" : "Cmd+P"}
          </span>
        </div>
        <div style={{ overflowY: "auto", padding: 6 }}>
          {loading && parsed.mode === "file" && parsed.query.trim() ? (
            <div style={emptyStyle}>{t("common.loading")}</div>
          ) : results.length === 0 ? (
            <div style={emptyStyle}>
              {parsed.mode === "file" && !parsed.query.trim()
                ? t("commandPalette.typeToSearch")
                : t("commandPalette.noResults")}
            </div>
          ) : (
            results.map((result, index) => {
              const active = index === activeIndex;
              const isCommand = result.kind === "command" && result.command;
              const IconComp = isCommand
                ? (result.command!.icon === "settings" ? Settings : TerminalSquare)
                : FileText;
              return (
                <button
                  key={`${result.kind}:${result.id}`}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => executeResult(result)}
                  style={{
                    width: "100%",
                    minHeight: 38,
                    display: "grid",
                    gridTemplateColumns: "22px minmax(0, 1fr)",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 10px",
                    border: "none",
                    borderRadius: "var(--radius-sm)",
                    background: active ? "var(--bg-hover)" : "transparent",
                    color: "var(--text-primary)",
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "flex", color: "var(--text-hint)" }}>
                    <IconComp size={15} />
                  </span>
                  <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                        fontWeight: 600,
                        color: active ? "var(--accent)" : "var(--text-primary)",
                      }}
                    >
                      {result.title}
                    </span>
                    {result.subtitle && (
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          fontSize: 11,
                          color: "var(--text-hint)",
                        }}
                      >
                        {result.subtitle}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "6px 14px",
            borderTop: "1px solid var(--border-dim)",
            fontSize: 10.5,
            color: "var(--text-hint)",
            flexShrink: 0,
          }}
        >
          <span>
            <kbd style={kbdStyle}>{'↑'}{'↓'}</kbd> {t("commandPalette.navigate")}
          </span>
          <span>
            <kbd style={kbdStyle}>{'↵'}</kbd> {t("commandPalette.select")}
          </span>
          <span>
            <kbd style={kbdStyle}>Tab</kbd> {t("commandPalette.toggleMode")}
          </span>
          <span style={{ marginLeft: "auto" }}>
            <kbd style={kbdStyle}>Esc</kbd> {t("commandPalette.close")}
          </span>
        </div>
      </div>
    </div>
  );
}

const emptyStyle = {
  padding: "28px 12px",
  color: "var(--text-muted)",
  textAlign: "center",
  fontSize: 12.5,
} satisfies CSSProperties;

const kbdStyle: CSSProperties = {
  display: "inline-block",
  padding: "1px 5px",
  borderRadius: 3,
  background: "var(--bg-subtle)",
  border: "1px solid var(--border-dim)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  lineHeight: 1.4,
};
