import { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Project, Task, ProjectGroup } from "../types";
import { ProjectAvatar } from "./ProjectAvatar";
import {
  railDragPreviewAvatarWrap,
  railDragPreviewStyle,
} from "../styles/rail-drag";
import {
  buildProjectActivityMap,
  getProjectActivity,
} from "./project-rail/activity";
import { ProjectDrawer } from "./project-rail/ProjectDrawer";
import { ProjectRailActions } from "./project-rail/ProjectRailActions";
import { RailItem } from "./project-rail/RailItem";
import {
  RAIL_DRAG_THRESHOLD_PX,
  RAIL_PADDING_TOP,
  RAIL_SUPPRESS_CLICK_MS,
  type DragOrigin,
  type DragViz,
} from "./project-rail/drag";

export { projectMatchesRailSearch } from "./project-rail/search";

export function ProjectRail({
  projects,
  allTasks,
  activeProjectId,
  attentionBadge = true,
  onSwitch,
  onCommitProjectOrder,
  onMoveToGroup,
  onMoveToHidden,
  onOpen,
  singleProjectMode = false,
}: {
  projects: Project[];
  allTasks: Task[];
  activeProjectId: string;
  attentionBadge?: boolean;
  onSwitch: (project: Project) => void;
  onCommitProjectOrder: (
    draggedId: string,
    beforeId: string | null,
    visibleIds: string[],
  ) => void;
  onMoveToGroup: (projectId: string, groupId: string | null) => void;
  onMoveToHidden: (projectId: string) => void;
  onOpen: () => void;
  singleProjectMode?: boolean;
}) {
  // 项目分组状态
  const [groups, setGroups] = useState<ProjectGroup[]>([]);
  const [groupCollapsed, setGroupCollapsed] = useState<Record<string, boolean>>({});
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");

  // 加载分组数据
  useEffect(() => {
    invoke<ProjectGroup[]>("load_project_groups")
      .then((g) => {
        setGroups(g);
        // 初始化折叠状态
        const collapsed: Record<string, boolean> = {};
        g.forEach((grp) => {
          collapsed[grp.id] = grp.collapsed;
        });
        setGroupCollapsed(collapsed);
      })
      .catch(() => {});
  }, []);

  // 保存分组折叠状态
  const saveGroupCollapsed = useCallback(
    (groupId: string, collapsed: boolean) => {
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, collapsed } : g)),
      );
      // 同步到后端（防抖由 useEffect 或手动触发处理）
      invoke("save_project_groups", {
        groups: groups.map((g) => (g.id === groupId ? { ...g, collapsed } : g)),
      }).catch(() => {});
    },
    [groups],
  );

  // 切换分组折叠
  const toggleGroup = useCallback(
    (groupId: string) => {
      setGroupCollapsed((prev) => {
        const next = { ...prev, [groupId]: !prev[groupId] };
        saveGroupCollapsed(groupId, next[groupId]);
        return next;
      });
    },
    [saveGroupCollapsed],
  );

  // 创建新分组
  const createGroup = useCallback(
    (name: string) => {
      if (!name.trim()) return;
      const newGroup: ProjectGroup = {
        id: `grp_${Date.now()}`,
        name: name.trim(),
        collapsed: false,
        order: groups.length,
      };
      const nextGroups = [...groups, newGroup];
      setGroups(nextGroups);
      invoke("save_project_groups", { groups: nextGroups }).catch(() => {});
      setNewGroupName("");
      setShowNewGroup(false);
    },
    [groups],
  );

  // 右键菜单状态
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    project: Project;
    showGroupSubmenu: boolean;
  } | null>(null);

  const handleProjectContextMenu = useCallback((e: React.MouseEvent, project: Project) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, project, showGroupSubmenu: false });
  }, []);

  const closeContextMenu = useCallback(() => setCtxMenu(null), []);

  // 分组拖拽重排序状态
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<string | null>(null);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [groupCtxMenu, setGroupCtxMenu] = useState<{ x: number; y: number; group: ProjectGroup } | null>(null);

  const deleteGroup = useCallback(
    (groupId: string) => {
      setGroups((prev) => {
        const next = prev.filter((g) => g.id !== groupId);
        invoke("save_project_groups", { groups: next }).catch(() => {});
        return next;
      });
      // 清除已删除分组的折叠状态
      setGroupCollapsed((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      setGroupCtxMenu(null);
    },
    [],
  );

  const groupDraggingRef = useRef<string | null>(null);

  const handleGroupDragStart = useCallback((_e: React.PointerEvent, groupId: string) => {
    groupDraggingRef.current = groupId;

    // 闭包变量，跨 handleMove / handleUp 同步记录最终 drop 目标
    let lastDropTarget: string | null = null;

    const handleMove = (moveEvent: PointerEvent) => {
      const container = railContainerRef.current;
      if (!container) return;

      const headers = Array.from(container.querySelectorAll<HTMLElement>("[data-group-id]"));
      let targetId: string | null = null;

      for (const header of headers) {
        const rect = header.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (header.dataset.groupId === groupId) continue;
        if (moveEvent.clientY < midY) {
          targetId = header.dataset.groupId || null;
          break;
        }
      }

      if (!targetId && headers.length > 1) {
        const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
        const lastGroup = sortedGroups[sortedGroups.length - 1];
        if (lastGroup && lastGroup.id !== groupId) {
          targetId = lastGroup.id;
        }
      }

      lastDropTarget = targetId;
      setGroupDropTarget(targetId);
    };

    const handleUp = () => {
      const dropTarget = lastDropTarget;
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);

      if (dropTarget && groupId !== dropTarget) {
        setGroups((prev) => {
          const sorted = [...prev].sort((a, b) => a.order - b.order);
          const dragIdx = sorted.findIndex((g) => g.id === groupId);
          const dropIdx = sorted.findIndex((g) => g.id === dropTarget);
          if (dragIdx === -1 || dropIdx === -1) return prev;

          const [removed] = sorted.splice(dragIdx, 1);
          sorted.splice(dropIdx, 0, removed);

          const updated = sorted.map((g, i) => ({ ...g, order: i }));
          invoke("save_project_groups", { groups: updated }).catch(() => {});
          return updated;
        });
      }

      groupDraggingRef.current = null;
      setDraggingGroupId(null);
      setGroupDropTarget(null);
    };

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  }, [groups]);

  // 按分组整理项目
  const groupedProjects = useMemo(() => {
    const result: { group: ProjectGroup | null; projects: Project[] }[] = [];
    const grouped = new Map<string, Project[]>();

    // 将项目分配到各分组
    projects.forEach((p) => {
      const gid = p.groupId;
      if (gid) {
        const arr = grouped.get(gid) ?? [];
        arr.push(p);
        grouped.set(gid, arr);
      }
    });

    // 按分组顺序添加
    const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
    sortedGroups.forEach((g) => {
      result.push({ group: g, projects: grouped.get(g.id) ?? [] });
    });

    // 未分组项目
    const ungrouped = projects.filter((p) => !p.groupId);
    if (ungrouped.length > 0) {
      result.push({ group: null, projects: ungrouped });
    }

    return result;
  }, [projects, groups]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 竖条只显示常驻项目；当前激活项目即使被设为非常驻也始终保留，避免失去当前上下文。
  const railProjects = useMemo(
    () => projects.filter((p) => !p.hiddenFromRail || p.id === activeProjectId),
    [projects, activeProjectId],
  );
  // 是否存在隐藏项目 — 决定是否需要显示抽屉切换按钮
  const hasHiddenProjects = useMemo(
    () => projects.some((p) => p.hiddenFromRail),
    [projects],
  );
  const projectActivityById = useMemo(() => buildProjectActivityMap(allTasks), [allTasks]);

  // 拖拽相关:dragOrigin 一旦设置就开始监听 document 事件;dragViz 高频更新 dropIndex / preview
  // 位置驱动让位动画与浮层。pointerup 时只 commit 一次,projects state 不在拖动过程中变化。
  const railContainerRef = useRef<HTMLDivElement>(null);
  const [dragOrigin, setDragOrigin] = useState<DragOrigin | null>(null);
  const [dragViz, setDragViz] = useState<DragViz | null>(null);
  const dragVizRef = useRef<DragViz | null>(null);
  const pendingDragVizRef = useRef<DragViz | null>(null);
  const dragVizRafRef = useRef<number | null>(null);
  const dragMovedRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const suppressClickProjectIdRef = useRef<string | null>(null);
  const suppressClickResetTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerNodeRef = useRef<HTMLButtonElement | null>(null);

  const railProjectsRef = useRef(railProjects);
  useEffect(() => {
    railProjectsRef.current = railProjects;
  }, [railProjects]);

  useEffect(() => {
    return () => {
      if (suppressClickResetTimerRef.current !== null) {
        window.clearTimeout(suppressClickResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!dragOrigin) return;

    function flushDragViz() {
      dragVizRafRef.current = null;
      const nextViz = pendingDragVizRef.current;
      pendingDragVizRef.current = null;
      if (nextViz) setDragViz(nextViz);
    }

    function scheduleDragViz(nextViz: DragViz) {
      dragVizRef.current = nextViz;
      pendingDragVizRef.current = nextViz;
      if (dragVizRafRef.current !== null) return;
      dragVizRafRef.current = requestAnimationFrame(flushDragViz);
    }

    function handleMove(event: PointerEvent) {
      const start = pointerStartRef.current;
      if (!start) return;

      if (!dragMovedRef.current) {
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (distance < RAIL_DRAG_THRESHOLD_PX) return;
        dragMovedRef.current = true;
      }

      const container = railContainerRef.current;
      if (!container || !dragOrigin) return;

      // 通过 DOM 元素位置计算插入索引（适配分组结构）
      const projectButtons = container.querySelectorAll<HTMLButtonElement>("[data-rail-id]");
      let dropIndex = railProjectsRef.current.length;

      for (let i = 0; i < projectButtons.length; i++) {
        const btn = projectButtons[i];
        const btnRect = btn.getBoundingClientRect();
        const btnMidY = btnRect.top + btnRect.height / 2;
        // 跳过正在拖拽的项目本身
        const btnId = btn.dataset.railId;
        if (btnId === dragOrigin.draggedId) continue;
        if (event.clientY < btnMidY) {
          dropIndex = i;
          break;
        }
      }

      // 检测是否悬停在分组头上
      let dropGroupId: string | null | undefined;
      const groupHeaders = container.querySelectorAll<HTMLElement>("[data-group-id]");
      for (const header of groupHeaders) {
        const rect = header.getBoundingClientRect();
        if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
          dropGroupId = header.dataset.groupId || null;
          break;
        }
      }

      const nextViz: DragViz = {
        dropIndex,
        previewX: event.clientX - dragOrigin.offsetX,
        previewY: event.clientY - dragOrigin.offsetY,
        dropGroupId,
      };
      scheduleDragViz(nextViz);
    }

    // pointerup 后会有 click 派发,dragMovedRef 留给 click 守卫读完再清;
    // pointercancel / blur 不会派发 click,如果不在此时清,ref 会停在 true 上,
    // 下次键盘 Tab+Enter 派发的 synthetic click 会被静默吞掉。
    function handleEnd(clearMovedNow: boolean) {
      const moved = dragMovedRef.current;
      const viz = dragVizRef.current;
      if (moved && viz && dragOrigin) {
        // 如果拖放到分组头 → 移动项目到该分组
        if (viz.dropGroupId !== undefined) {
          onMoveToGroup(dragOrigin.draggedId, viz.dropGroupId);
        } else {
          // 使用 DOM 顺序计算 visibleIds，确保与视觉显示顺序一致。
          // railProjectsRef.current 是存储顺序，display 可能是分组排序后的 DOM 顺序，二者不同。
          const container = railContainerRef.current;
          const domButtons = container
            ? Array.from(container.querySelectorAll<HTMLButtonElement>("[data-rail-id]"))
            : [];
          const visibleIds = domButtons
            .map((b) => b.dataset.railId)
            .filter((id): id is string => !!id);
          const draggedVisibleIdx = visibleIds.indexOf(dragOrigin.draggedId);
          const dropIdx = viz.dropIndex;
          const noop =
            draggedVisibleIdx === -1 ||
            dropIdx === draggedVisibleIdx ||
            dropIdx === draggedVisibleIdx + 1;
          if (!noop) {
            const beforeId = dropIdx < visibleIds.length ? visibleIds[dropIdx] : null;
            onCommitProjectOrder(dragOrigin.draggedId, beforeId, visibleIds);
          }
        }
      }
      const pointerId = activePointerIdRef.current;
      const pointerNode = activePointerNodeRef.current;
      if (pointerId !== null && pointerNode?.hasPointerCapture(pointerId)) {
        pointerNode.releasePointerCapture(pointerId);
      }
      activePointerIdRef.current = null;
      activePointerNodeRef.current = null;
      pointerStartRef.current = null;
      pendingDragVizRef.current = null;
      if (dragVizRafRef.current !== null) {
        cancelAnimationFrame(dragVizRafRef.current);
        dragVizRafRef.current = null;
      }
      dragVizRef.current = null;
      setDragViz(null);
      setDragOrigin(null);
      if (clearMovedNow || !moved || !dragOrigin) {
        dragMovedRef.current = false;
      } else {
        if (suppressClickResetTimerRef.current !== null) {
          window.clearTimeout(suppressClickResetTimerRef.current);
        }
        suppressClickUntilRef.current = performance.now() + RAIL_SUPPRESS_CLICK_MS;
        suppressClickProjectIdRef.current = dragOrigin.draggedId;
        suppressClickResetTimerRef.current = window.setTimeout(() => {
          dragMovedRef.current = false;
          suppressClickUntilRef.current = 0;
          suppressClickProjectIdRef.current = null;
          suppressClickResetTimerRef.current = null;
        }, RAIL_SUPPRESS_CLICK_MS);
      }
    }

    function handlePointerUp() {
      handleEnd(false);
    }
    function handleAbort() {
      handleEnd(true);
    }

    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handleAbort);
    window.addEventListener("blur", handleAbort);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handleAbort);
      window.removeEventListener("blur", handleAbort);
      if (dragVizRafRef.current !== null) {
        cancelAnimationFrame(dragVizRafRef.current);
        dragVizRafRef.current = null;
      }
    };
  }, [dragOrigin, onCommitProjectOrder]);

  const handleRailItemPointerDown = useCallback((
    project: Project,
    event: React.PointerEvent<HTMLButtonElement>,
  ) => {
    if (event.button !== 0) return;
    const node = event.currentTarget;
    const rect = node.getBoundingClientRect();
    node.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    activePointerNodeRef.current = node;
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    // dragViz 不在 pointerdown 立即 set:纯 click 切项目走不到 handleMove 阈值,
    // 也不该触发浮层 mount / ProjectAvatar 实例化。延后到 handleMove 第一次
    // 跨过 RAIL_DRAG_THRESHOLD_PX 阈值时再初始化。
    setDragOrigin({
      draggedId: project.id,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    });
  }, []);

  const handleRailItemClick = useCallback((project: Project) => {
    const shouldSuppressClick =
      dragMovedRef.current ||
      (project.id === suppressClickProjectIdRef.current &&
        performance.now() < suppressClickUntilRef.current);
    if (shouldSuppressClick) {
      dragMovedRef.current = false;
      suppressClickUntilRef.current = 0;
      suppressClickProjectIdRef.current = null;
      if (suppressClickResetTimerRef.current !== null) {
        window.clearTimeout(suppressClickResetTimerRef.current);
        suppressClickResetTimerRef.current = null;
      }
      return;
    }
    onSwitch(project);
    setDrawerOpen(false);
  }, [onSwitch]);

  const draggedVisibleIndex = dragOrigin
    ? railProjects.findIndex((p) => p.id === dragOrigin.draggedId)
    : -1;
  const draggedProject =
    dragOrigin && draggedVisibleIndex !== -1 ? railProjects[draggedVisibleIndex] : null;
  // 招手触发:记录每个项目上一次的待确认数量,数量增加(0→≥1 或 n→n+1)时给该项目
  // 递增一个 nonce,RailItem 据此播一次招手动画。首帧只做初始化播种,不为已有任务招手。
  const prevAttentionRef = useRef<Map<string, number>>(new Map());
  const seededRef = useRef(false);
  const [waveNonces, setWaveNonces] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    const triggered: string[] = [];
    for (const p of railProjects) {
      const count = getProjectActivity(projectActivityById, p.id).attentionCount;
      const prev = prevAttentionRef.current.get(p.id) ?? 0;
      if (seededRef.current && count > prev) triggered.push(p.id);
      prevAttentionRef.current.set(p.id, count);
    }
    seededRef.current = true;
    if (triggered.length === 0) return;
    setWaveNonces((prev) => {
      const next = new Map(prev);
      for (const id of triggered) next.set(id, (next.get(id) ?? 0) + 1);
      return next;
    });
  }, [projectActivityById, railProjects]);

  // 侧边栏宽度调整
  const [railWidth, setRailWidth] = useState(() => {
    const saved = localStorage.getItem("nezha:rail-width");
    return saved ? Math.max(140, Math.min(320, parseInt(saved, 10))) : 180;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(180);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = railWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    if (!isResizing) return;
    const handleMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      const newWidth = Math.max(140, Math.min(320, resizeStartWidth.current + delta));
      setRailWidth(newWidth);
    };
    const handleUp = () => {
      setIsResizing(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("nezha:rail-width", String(railWidth));
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [isResizing, railWidth]);

  return (
    <div
      ref={railContainerRef}
      style={{
        position: "relative",
        width: railWidth,
        flexShrink: 0,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid var(--border-dim)",
        display: "flex",
        flexDirection: "column",
        paddingTop: RAIL_PADDING_TOP,
        paddingBottom: 10,
        overflow: isResizing ? "hidden" : "visible",
        zIndex: drawerOpen ? 50 : "auto",
        transition: isResizing ? "none" : "width 0.1s ease",
      }}
    >
      {/* Scrollable grouped project list */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", minHeight: 0, position: "relative" }}>
        {groupedProjects.map(({ group, projects: groupProjects }) => {
          const isCollapsed = group ? groupCollapsed[group.id] ?? false : false;
          return (
            <div key={group?.id ?? "__ungrouped__"}>
              {/* 分组头 */}
              {group && (
                <div
                  data-group-id={group.id}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setGroupCtxMenu({ x: e.clientX, y: e.clientY, group });
                  }}
                  style={{
                    position: "relative",
                    background: draggingGroupId === group.id
                      ? "var(--accent-subtle)"
                      : dragViz?.dropGroupId === group.id
                        ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                        : groupDropTarget === group.id
                          ? "var(--bg-selected)"
                          : "none",
                    borderRadius: 6,
                    transition: "background 0.15s ease",
                  }}
                  onMouseEnter={() => setHoveredGroup(group.id)}
                  onMouseLeave={() => setHoveredGroup(null)}
                >
                  {/* 拖拽指示线（目标位置上方） */}
                  {groupDropTarget === group.id && draggingGroupId !== group.id && (
                    <div style={{ position: "absolute", top: 0, left: 8, right: 8, height: 2, background: "var(--accent, #4ade80)", zIndex: 1 }} />
                  )}
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <button
                      data-toggle="group"
                      onPointerDown={(e) => handleGroupDragStart(e, group.id)}
                      onClick={() => {
                        if (draggingGroupId) return;
                        toggleGroup(group.id);
                      }}
                      style={{
                        flex: 1,
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "6px 14px 4px",
                        background: "none",
                        border: "none",
                        cursor: draggingGroupId ? "grabbing" : "pointer",
                        fontSize: 12,
                        fontWeight: 600,
                        color: draggingGroupId === group.id ? "var(--text-primary)" : "var(--text-hint)",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        textAlign: "left",
                        opacity: draggingGroupId === group.id ? 0.5 : 1,
                        transition: "color 0.15s ease, opacity 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        if (!draggingGroupId) e.currentTarget.style.color = "var(--text-secondary)";
                      }}
                      onMouseLeave={(e) => {
                        if (!draggingGroupId) e.currentTarget.style.color = "var(--text-hint)";
                      }}
                      title={isCollapsed ? "展开分组 (+拖动排序)" : "折叠分组 (+拖动排序)"}
                    >
                      <span style={{ fontSize: 10, transform: isCollapsed ? "none" : "rotate(90deg)", transition: "transform 0.15s ease" }}>
                        ▶
                      </span>
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
                        {group.name}
                      </span>
                      <span style={{ opacity: 0.6, marginLeft: 4 }}>({groupProjects.length})</span>
                    </button>
                    {/* 分组操作按钮（悬停显示） */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setGroupCtxMenu({ x: e.clientX, y: e.clientY, group });
                      }}
                      style={{
                        padding: "2px 6px",
                        marginRight: 4,
                        background: "none",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        color: "var(--text-hint)",
                        fontSize: 12,
                        opacity: hoveredGroup === group.id ? 1 : 0,
                        transition: "opacity 0.15s ease",
                      }}
                      title="分组操作"
                    >
                      ⋯
                    </button>
                  </div>
                </div>
             )}
              {/* 分组项目（折叠时隐藏） */}
              {!isCollapsed &&
                groupProjects.map((project) => {
                  const isDragging = dragOrigin?.draggedId === project.id;
                  const activity = getProjectActivity(projectActivityById, project.id);
                  return (
                    <RailItem
                      key={project.id}
                      project={project}
                      isActive={project.id === activeProjectId}
                      status={activity.status}
                      attentionCount={activity.attentionCount}
                      showBadge={attentionBadge}
                      waveNonce={waveNonces.get(project.id) ?? 0}
                      isDragging={isDragging}
                      translateY={0}
                      onPointerDown={handleRailItemPointerDown}
                      onClick={handleRailItemClick}
                      onContextMenu={handleProjectContextMenu}
                    />
                  );
                })}
            </div>
          );
        })}

        {/* 新建分组 / 折叠全部 按钮 */}
        {!singleProjectMode && (
          <div style={{ padding: "8px 14px" }}>
            {showNewGroup ? (
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createGroup(newGroupName);
                    if (e.key === "Escape") { setShowNewGroup(false); setNewGroupName(""); }
                  }}
                  placeholder="分组名称..."
                  style={{
                    flex: 1,
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border-dim)",
                    background: "var(--bg-input)",
                    color: "var(--text-primary)",
                    fontSize: 12,
                    outline: "none",
                  }}
                />
                <button
                  onClick={() => createGroup(newGroupName)}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "none",
                    background: "var(--accent, #4ade80)",
                    color: "#fff",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ✓
                </button>
                <button
                  onClick={() => { setShowNewGroup(false); setNewGroupName(""); }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 6,
                    border: "1px solid var(--border-dim)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowNewGroup(true)}
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: 6,
                  border: "1px dashed var(--border-dim)",
                  background: "transparent",
                  color: "var(--text-hint)",
                  fontSize: 12,
                  cursor: "pointer",
                  textAlign: "center",
                  transition: "border-color 0.15s ease, color 0.15s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent, #4ade80)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--accent, #4ade80)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border-dim)";
                  (e.currentTarget as HTMLButtonElement).style.color = "var(--text-hint)";
                }}
              >
                + 新建分组
              </button>
            )}
          </div>
        )}
      </div>

      {!singleProjectMode && (
        <ProjectRailActions
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerOpen((v) => !v)}
          onOpen={onOpen}
          hasHiddenProjects={hasHiddenProjects}
        />
      )}

      {/* Resize handle — right edge */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: -3,
          width: 6,
          cursor: "col-resize",
          zIndex: 10,
          background: isResizing ? "var(--accent, #4ade80)" : "transparent",
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => {
          if (!isResizing) (e.currentTarget as HTMLDivElement).style.background = "var(--accent, #4ade80)";
        }}
        onMouseLeave={(e) => {
          if (!isResizing) (e.currentTarget as HTMLDivElement).style.background = "transparent";
        }}
      />

      {drawerOpen && !singleProjectMode && (
        <ProjectDrawer
          projects={projects}
          activityByProjectId={projectActivityById}
          activeProjectId={activeProjectId}
          showBadge={attentionBadge}
          onSwitch={onSwitch}
          onClose={() => setDrawerOpen(false)}
          railWidth={railWidth}
        />
      )}

      {draggedProject && dragViz && (
        <div
          style={railDragPreviewStyle({
            x: dragViz.previewX,
            y: dragViz.previewY,
            size: 180,
            horizontal: true,
          })}
        >
          <div style={railDragPreviewAvatarWrap}>
            <ProjectAvatar name={draggedProject.name} size={32} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>
            {draggedProject.name}
          </span>
        </div>
      )}

      {/* 右键菜单 */}
      {ctxMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 998 }}
            onClick={closeContextMenu}
            onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
          />
          <div
            style={{
              position: "fixed",
              left: Math.min(ctxMenu.x, window.innerWidth - 220),
              top: Math.min(ctxMenu.y, window.innerHeight - 300),
              minWidth: 200,
              maxWidth: 260,
              background: "var(--bg-panel, #fff)",
              border: "1px solid var(--border-dim)",
              borderRadius: 8,
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
              zIndex: 999,
              padding: "4px 0",
            }}
          >
            {/* 标题 */}
            <div style={{ padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)", borderBottom: "1px solid var(--border-dim)", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ctxMenu.project.name}
            </div>

            {/* 移动到分组 */}
            <div style={{ position: "relative" }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setCtxMenu((prev => prev ? { ...prev, showGroupSubmenu: !prev.showGroupSubmenu } : null));
                }}
                style={{
                  width: "100%", padding: "7px 14px", textAlign: "left",
                  background: ctxMenu.showGroupSubmenu ? "var(--bg-hover)" : "none",
                  border: "none", cursor: "pointer",
                  fontSize: 12.5, color: "var(--text-secondary)",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}
                onMouseEnter={(e) => { if (!ctxMenu.showGroupSubmenu) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (!ctxMenu.showGroupSubmenu) e.currentTarget.style.background = "none"; }}
              >
                <span>移动到分组</span>
                <span style={{ fontSize: 10, opacity: 0.6 }}>▶</span>
              </button>

              {/* 子菜单：分组列表 */}
              {ctxMenu.showGroupSubmenu && (
                <div
                  style={{
                    position: "absolute",
                    left: "100%",
                    top: 0,
                    minWidth: 160,
                    background: "var(--bg-panel, #fff)",
                    border: "1px solid var(--border-dim)",
                    borderRadius: 8,
                    boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
                    zIndex: 1000,
                    padding: "4px 0",
                    marginLeft: 4,
                  }}
                >
                  {/* 未分组选项 */}
                  <button
                    onClick={() => {
                      onMoveToGroup(ctxMenu.project.id, null);
                      closeContextMenu();
                    }}
                    style={{
                      width: "100%", padding: "6px 12px", textAlign: "left",
                      background: !ctxMenu.project.groupId ? "var(--accent-subtle)" : "none",
                      border: "none", cursor: "pointer",
                      fontSize: 12, color: ctxMenu.project.groupId ? "var(--text-secondary)" : "var(--accent)",
                    }}
                  >
                    {!ctxMenu.project.groupId ? "✓ " : ""}未分组
                  </button>
                  {/* 分组列表 */}
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      onClick={() => {
                        onMoveToGroup(ctxMenu.project.id, g.id);
                        closeContextMenu();
                      }}
                      style={{
                        width: "100%", padding: "6px 12px", textAlign: "left",
                        background: ctxMenu.project.groupId === g.id ? "var(--accent-subtle)" : "none",
                        border: "none", cursor: "pointer",
                        fontSize: 12, color: ctxMenu.project.groupId === g.id ? "var(--accent)" : "var(--text-secondary)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {ctxMenu.project.groupId === g.id ? "✓ " : ""}{g.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 前往项目 */}
            <button
              onClick={() => { onSwitch(ctxMenu.project); closeContextMenu(); }}
              style={{
                width: "100%", padding: "7px 14px", textAlign: "left",
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12.5, color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              前往项目
            </button>

            <div style={{ height: 1, margin: "4px 0", background: "var(--border-dim)" }} />

            {/* 从侧边栏隐藏（低优先级） */}
            <button
              onClick={() => {
                onMoveToHidden(ctxMenu.project.id);
                closeContextMenu();
              }}
              style={{
                width: "100%", padding: "7px 14px", textAlign: "left",
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12.5, color: "var(--text-hint)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              从侧边栏隐藏
            </button>
          </div>
        </>
      )}

      {/* 分组右键菜单 */}
      {groupCtxMenu && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 998 }}
            onClick={() => setGroupCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setGroupCtxMenu(null); }}
          />
          <div
            style={{
              position: "fixed",
              left: Math.min(groupCtxMenu.x, window.innerWidth - 200),
              top: Math.min(groupCtxMenu.y, window.innerHeight - 160),
              minWidth: 180,
              background: "var(--bg-panel, #fff)",
              border: "1px solid var(--border-dim)",
              borderRadius: 8,
              boxShadow: "0 4px 24px rgba(0,0,0,0.18)",
              zIndex: 999,
              padding: "4px 0",
            }}
          >
            <div style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, color: "var(--text-primary)", borderBottom: "1px solid var(--border-dim)", marginBottom: 4 }}>
              分组: {groupCtxMenu.group.name}
            </div>
            <button
              onClick={() => {
                // 折叠/展开分组
                toggleGroup(groupCtxMenu.group.id);
                setGroupCtxMenu(null);
              }}
              style={{
                width: "100%", padding: "7px 14px", textAlign: "left",
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12.5, color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              {groupCollapsed[groupCtxMenu.group.id] ? "展开分组" : "折叠分组"}
            </button>
            <button
              onClick={() => {
                // 移除分组中的所有项目（将它们变为未分组）
                projects.filter((p) => p.groupId === groupCtxMenu.group.id).forEach((p) => onMoveToGroup(p.id, null));
                setGroupCtxMenu(null);
              }}
              style={{
                width: "100%", padding: "7px 14px", textAlign: "left",
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12.5, color: "var(--text-secondary)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              移除分组中所有项目
            </button>
            <div style={{ height: 1, margin: "4px 0", background: "var(--border-dim)" }} />
            <button
              onClick={() => {
                if (confirm(`确定删除分组「${groupCtxMenu.group.name}」吗？分组中的项目将变为未分组。`)) {
                  deleteGroup(groupCtxMenu.group.id);
                }
              }}
              style={{
                width: "100%", padding: "7px 14px", textAlign: "left",
                background: "none", border: "none", cursor: "pointer",
                fontSize: 12.5, color: "var(--danger, #dc2626)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              删除分组
            </button>
          </div>
        </>
      )}
    </div>
  );
}
