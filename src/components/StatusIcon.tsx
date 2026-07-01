import {
  CheckCircle2,
  XCircle,
  Circle,
  Loader2,
  AlertTriangle,
  WifiOff,
  CircleDot,
} from "lucide-react";
import type { TaskStatus } from "../types";

export const STATUS_ICON_SIZE = 14;

export function StatusIcon({ status }: { status: TaskStatus }) {
  const iconStyle = (opacity?: number) => opacity !== undefined ? { opacity } : {};
  switch (status) {
    case "running":
      return <Loader2 size={STATUS_ICON_SIZE} style={{ animation: "spin 1.2s linear infinite" }} />;
    case "pending":
      return <CircleDot size={STATUS_ICON_SIZE} style={iconStyle(0.7)} />;
    case "input_required":
      return <AlertTriangle size={STATUS_ICON_SIZE} />;
    case "detached":
      return <WifiOff size={STATUS_ICON_SIZE} />;
    case "interrupted":
      return <AlertTriangle size={STATUS_ICON_SIZE} />;
    case "done":
      return <CheckCircle2 size={STATUS_ICON_SIZE} />;
    case "failed":
      return <XCircle size={STATUS_ICON_SIZE} />;
    case "cancelled":
      return <Circle size={STATUS_ICON_SIZE} style={iconStyle(0.4)} />;
    case "todo":
      return <Circle size={STATUS_ICON_SIZE} style={iconStyle(0.5)} />;
    default:
      return <Circle size={STATUS_ICON_SIZE} style={iconStyle(0.3)} />;
  }
}

/** 获取状态的文字描述（支持 i18n key 查找）。 */
export function statusLabelKey(status: TaskStatus): string {
  const keyMap: Record<TaskStatus, string> = {
    running: "status.running",
    pending: "status.pending",
    input_required: "status.inputRequired",
    detached: "status.detached",
    interrupted: "status.interrupted",
    done: "status.done",
    failed: "status.failed",
    cancelled: "status.cancelled",
    todo: "status.todo",
  };
  return keyMap[status] || status;
}
