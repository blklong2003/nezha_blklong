import { useState, useCallback, useRef } from "react";

type RightPanel = "files" | "git-changes" | "git-history" | null;
type OpenFileTab = { path: string; name: string };

type OpenDiff =
  | { kind: "file"; filePath: string; staged: boolean; label: string }
  | { kind: "commit"; hash: string; message: string }
  | { kind: "commit-file"; hash: string; filePath: string; label: string };

interface PanelState {
  rightPanel: RightPanel;
  openFiles: OpenFileTab[];
  activeFilePath: string | null;
  openDiff: OpenDiff | null;
  rightPanelWidth: number;
  terminalHeight: number;
}

const DEFAULT_STATE: PanelState = {
  rightPanel: null,
  openFiles: [],
  activeFilePath: null,
  openDiff: null,
  rightPanelWidth: 280,
  terminalHeight: 240,
};

// Per-project state cache: remembers right panel state across project switches.
const stateCache = new Map<string, PanelState>();

function getCached(projectId: string): PanelState {
  const c = stateCache.get(projectId);
  if (c) return { ...c, openFiles: [...c.openFiles] };
  return { ...DEFAULT_STATE };
}

export function useProjectPanels(projectId: string) {
  const [state, setState] = useState<PanelState>(() => getCached(projectId));

  // When projectId changes: persist current state, load new project state.
  const prevIdRef = useRef(projectId);
  if (prevIdRef.current !== projectId) {
    stateCache.set(prevIdRef.current, { ...state, openFiles: [...state.openFiles] });
    setState(getCached(projectId));
    prevIdRef.current = projectId;
  }

  const persist = useCallback((s: PanelState) => {
    stateCache.set(projectId, { ...s, openFiles: [...s.openFiles] });
  }, [projectId]);

  const update = useCallback((fn: (prev: PanelState) => PanelState) => {
    setState((prev) => { const next = fn(prev); persist(next); return next; });
  }, [persist]);

  const handleTogglePanel = useCallback((panel: Exclude<RightPanel, null>) => {
    update((prev) => ({ ...prev, rightPanel: prev.rightPanel === panel ? null : panel }));
  }, [update]);

  const openRightPanel = useCallback((panel: Exclude<RightPanel, null>) => {
    update((prev) => ({ ...prev, rightPanel: panel }));
  }, [update]);

  const handleFileSelect = useCallback((path: string, name: string) => {
    update((prev) => ({
      ...prev,
      openFiles: prev.openFiles.some((t) => t.path === path) ? prev.openFiles : [...prev.openFiles, { path, name }],
      activeFilePath: path,
      openDiff: null,
    }));
  }, [update]);

  const handleFileTabSelect = useCallback((path: string) => {
    update((prev) => ({
      ...prev,
      activeFilePath: prev.openFiles.some((t) => t.path === path) ? path : prev.activeFilePath,
    }));
  }, [update]);

  const handleFileTabClose = useCallback((path: string) => {
    update((prev) => {
      const idx = prev.openFiles.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const nextTabs = prev.openFiles.filter((t) => t.path !== path);
      const nextActive = prev.activeFilePath !== path ? prev.activeFilePath : nextTabs[Math.min(idx, nextTabs.length - 1)]?.path ?? null;
      return { ...prev, openFiles: nextTabs, activeFilePath: nextActive };
    });
  }, [update]);

  const handleCloseOtherFileTabs = useCallback((path: string) => {
    update((prev) => {
      const tab = prev.openFiles.find((t) => t.path === path);
      if (!tab) return prev;
      return { ...prev, openFiles: [tab], activeFilePath: tab.path };
    });
  }, [update]);

  const handleCloseTabsToRight = useCallback((path: string) => {
    update((prev) => {
      const idx = prev.openFiles.findIndex((t) => t.path === path);
      if (idx === -1) return prev;
      const nextTabs = prev.openFiles.slice(0, idx + 1);
      return { ...prev, openFiles: nextTabs, activeFilePath: nextTabs.some((t) => t.path === prev.activeFilePath) ? prev.activeFilePath : path };
    });
  }, [update]);

  const handleCloseTabsToLeft = useCallback((path: string) => {
    update((prev) => {
      const idx = prev.openFiles.findIndex((t) => t.path === path);
      if (idx <= 0) return prev;
      const nextTabs = prev.openFiles.slice(idx);
      return { ...prev, openFiles: nextTabs, activeFilePath: nextTabs.some((t) => t.path === prev.activeFilePath) ? prev.activeFilePath : path };
    });
  }, [update]);

  const handleCloseAllFileTabs = useCallback(() => {
    update((prev) => ({ ...prev, openFiles: [], activeFilePath: null }));
  }, [update]);

  const handleDiffFileSelect = useCallback((filePath: string, staged: boolean, label: string) => {
    update((prev) => ({ ...prev, openDiff: { kind: "file" as const, filePath, staged, label } }));
  }, [update]);

  const handleCommitSelect = useCallback((hash: string, message: string) => {
    update((prev) => ({ ...prev, openDiff: { kind: "commit" as const, hash, message } }));
  }, [update]);

  const handleCommitFileClick = useCallback((hash: string, filePath: string, label: string) => {
    update((prev) => ({ ...prev, openDiff: { kind: "commit-file" as const, hash, filePath, label } }));
  }, [update]);

  const clearFileAndDiff = useCallback(() => {
    update((prev) => ({ ...prev, openFiles: [], activeFilePath: null, openDiff: null }));
  }, [update]);

  const setOpenDiff = useCallback((diff: OpenDiff | null) => {
    update((prev) => ({ ...prev, openDiff: diff }));
  }, [update]);

  const handleRightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = state.rightPanelWidth;
    const onMouseMove = (ev: MouseEvent) => {
      const w = Math.max(180, Math.min(600, startWidth + (startX - ev.clientX)));
      update((prev) => ({ ...prev, rightPanelWidth: w }));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [state.rightPanelWidth, update]);

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = state.terminalHeight;
    const onMouseMove = (ev: MouseEvent) => {
      const h = Math.max(100, Math.min(600, startHeight + (startY - ev.clientY)));
      update((prev) => ({ ...prev, terminalHeight: h }));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [state.terminalHeight, update]);

  return {
    rightPanel: state.rightPanel,
    openFiles: state.openFiles,
    activeFilePath: state.activeFilePath,
    openDiff: state.openDiff,
    rightPanelWidth: state.rightPanelWidth,
    terminalHeight: state.terminalHeight,
    setOpenDiff,
    openRightPanel,
    handleTogglePanel,
    handleFileSelect,
    handleFileTabSelect,
    handleFileTabClose,
    handleCloseOtherFileTabs,
    handleCloseTabsToRight,
    handleCloseTabsToLeft,
    handleCloseAllFileTabs,
    handleDiffFileSelect,
    handleCommitSelect,
    handleCommitFileClick,
    clearFileAndDiff,
    handleRightResizeStart,
    handleTerminalResizeStart,
  };
}

export type { RightPanel, OpenDiff, OpenFileTab };
