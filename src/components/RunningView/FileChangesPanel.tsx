import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FilePlus, FileMinus, FileEdit } from "lucide-react";
import { useI18n } from "../../i18n";

interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  additions: number;
  deletions: number;
}

interface Props {
  worktreePath?: string;
  projectPath: string;
}

/**
 * 文件变更面板 — 显示 worktree 中创建/修改/删除的文件列表。
 */
export function FileChangesPanel({ worktreePath, projectPath }: Props) {
  const { t } = useI18n();
  const [files, setFiles] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!worktreePath) {
      setFiles([]);
      return;
    }

    let cancelled = false;
    setLoading(true);

    invoke<string>("get_worktree_changed_files", { worktreePath, projectPath })
      .then((output) => {
        if (cancelled) return;
        const parsed = parseGitStatus(output);
        setFiles(parsed);
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [worktreePath, projectPath]);

  if (loading) {
    return (
      <div style={{ padding: 16, color: "var(--text-hint)", fontSize: 13 }}>
        {t("common.loading")}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div style={{ padding: 16, color: "var(--text-hint)", fontSize: 13 }}>
        {t("git.noChanges")}
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", padding: "8px 0" }}>
      {files.map((file) => (
        <div
          key={file.path}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 16px",
            fontSize: 12,
            color: "var(--text-secondary)",
          }}
        >
          <FileIcon status={file.status} />
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.path}
          </span>
          {file.additions > 0 && (
            <span style={{ color: "var(--success)", fontSize: 11 }}>+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span style={{ color: "var(--danger)", fontSize: 11 }}>−{file.deletions}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function FileIcon({ status }: { status: FileChange["status"] }) {
  const style = { flexShrink: 0 };
  switch (status) {
    case "added":
      return <FilePlus size={13} style={{ ...style, color: "var(--success)" }} />;
    case "deleted":
      return <FileMinus size={13} style={{ ...style, color: "var(--danger)" }} />;
    case "modified":
      return <FileEdit size={13} style={{ ...style, color: "var(--warning)" }} />;
  }
}

function parseGitStatus(output: string): FileChange[] {
  const files: FileChange[] = [];
  for (const line of output.split("\n")) {
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    const path = line.slice(3).trim();
    if (!path) continue;

    let status: FileChange["status"];
    if (x === "?" || y === "?") {
      status = "added";
    } else if (x === "D" || y === "D") {
      status = "deleted";
    } else {
      status = "modified";
    }

    files.push({ path, status, additions: 0, deletions: 0 });
  }
  return files;
}