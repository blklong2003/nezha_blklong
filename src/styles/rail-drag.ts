import type React from "react";

// RailItem 的尺寸与项间距来自 ProjectRail 的视觉规范:item 44px、container gap 6px。
// 拖拽时让位距离 = item + gap,改这里需要同步 ProjectRail 的对应字段。
export const RAIL_ITEM_SIZE = 44;
export const RAIL_ITEM_GAP = 6;
export const RAIL_ITEM_STRIDE = RAIL_ITEM_SIZE + RAIL_ITEM_GAP;

// 跟手指走的拖拽预览浮层。fixed 定位、不响应事件、置顶。
export function railDragPreviewStyle({
  x,
  y,
  size,
  horizontal = false,
}: {
  x: number;
  y: number;
  size: number;
  horizontal?: boolean;
}): React.CSSProperties {
  const activeShadow = "0 12px 40px rgba(0,0,0,0.35), 0 4px 12px rgba(0,0,0,0.18)";

  if (horizontal) {
    return {
      position: "fixed",
      left: x,
      top: y,
      width: size,
      height: 44,
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "0 12px",
      borderRadius: 10,
      background: "color-mix(in srgb, var(--bg-sidebar) 90%, white 10%)",
      boxShadow: activeShadow,
      transform: "scale(1.03)",
      pointerEvents: "none",
      zIndex: 999,
      transition: "transform 0.15s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.15s ease",
    };
  }
  return {
    position: "fixed",
    left: x,
    top: y,
    width: size,
    height: size,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    background: "color-mix(in srgb, var(--bg-sidebar) 90%, white 10%)",
    boxShadow: activeShadow,
    transform: "scale(1.05)",
    pointerEvents: "none",
    zIndex: 999,
    transition: "transform 0.15s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.15s ease",
  };
}

// 浮层内部为 ProjectAvatar + AttentionIndicator 提供 stacking context。
export const railDragPreviewAvatarWrap: React.CSSProperties = {
  position: "relative",
  width: 32,
  height: 32,
};
