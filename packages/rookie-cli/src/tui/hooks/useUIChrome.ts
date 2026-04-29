// ─── UI Chrome Domain Hook ───────────────────────────────────────
// Mode, status, derived status info

import { useState, useCallback } from "react";
import type { TuiMode, StatusInfo } from "../types.js";

export interface UIChromeMeta {
  modelName: string;
  directory: string;
  branch?: string;
}

export function useUIChrome(_meta: UIChromeMeta) {
  const [mode, setModeState] = useState<TuiMode>("chat");
  const [isPlanMode, setIsPlanMode] = useState(false);

  const setMode = useCallback((newMode: TuiMode) => {
    setModeState(newMode);
    setIsPlanMode(newMode === "plan");
  }, []);

  return {
    mode,
    setMode,
    isPlanMode,
  };
}

// Derived status builder — called by useTuiState after collecting all domain states
export function buildStatusInfo(
  meta: UIChromeMeta,
  streamStatus: "idle" | "streaming" | "stalled" | "recovering",
  isProcessing: boolean,
  longTasks: { status: string }[],
  pendingApprovals: number,
  pendingQuestions: number
): StatusInfo {
  return {
    model: meta.modelName,
    directory: meta.directory,
    branch: meta.branch,
    permissions: "normal",
    taskStatus: streamStatus === "stalled" ? "stalled" : isProcessing ? "running" : "idle",
    backgroundProcesses: longTasks.filter(t => t.status === "running").length,
    pendingApprovals,
    pendingQuestions,
    streamStatus,
  };
}
