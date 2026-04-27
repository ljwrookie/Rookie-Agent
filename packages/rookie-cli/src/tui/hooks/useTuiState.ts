// ─── Central TUI State Hook ──────────────────────────────────────
// Single source of truth for the entire TUI state machine

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type {
  TuiMode, StreamEvent, ApprovalRequest, PlanState,
  DiffFile, StructuredError, LongTask, WorkspaceContext, StatusInfo,
  EventSeverity,
} from "../types.js";

// Stream idle detection configuration (from CCB)
const STALL_THRESHOLD_MS = parseInt(process.env.ROOKIE_STALL_THRESHOLD_MS || "30000", 10);
const STREAM_IDLE_TIMEOUT_MS = parseInt(process.env.ROOKIE_STREAM_IDLE_TIMEOUT_MS || "90000", 10);
const MAX_RETRIES = 2;

const initialContext: WorkspaceContext = {
  directory: process.cwd(),
  gitBranch: undefined,
  gitDirty: false,
  recentFiles: [],
  activeFiles: [],
  taskCount: { total: 0, done: 0, pending: 0 },
};

// A4: Callback for plan mode changes
export interface TuiStateCallbacks {
  onPlanModeChange?: (isPlanMode: boolean) => void;
}

export function useTuiState(
  meta: {
    modelName: string;
    directory: string;
    branch?: string;
  },
  callbacks?: TuiStateCallbacks
) {
  const [mode, setModeState] = useState<TuiMode>("chat");
  // A4: Track plan mode state
  const [isPlanMode, setIsPlanMode] = useState(false);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [plan, setPlan] = useState<PlanState | null>(null);

  // A4: Wrapped setMode that handles plan mode transitions
  const setMode = useCallback((newMode: TuiMode) => {
    setModeState(newMode);
    const enteringPlanMode = newMode === "plan";
    setIsPlanMode(enteringPlanMode);
    // Notify callback for ToolRegistry integration
    callbacks?.onPlanModeChange?.(enteringPlanMode);
  }, [callbacks]);
  const [diffs, setDiffs] = useState<DiffFile[]>([]);
  const [errors, setErrors] = useState<StructuredError[]>([]);
  const [longTasks, setLongTasks] = useState<LongTask[]>([]);
  const [context, setContext] = useState<WorkspaceContext>({
    ...initialContext,
    directory: meta.directory,
    gitBranch: meta.branch,
  });
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [selectedEventIdx, setSelectedEventIdx] = useState(-1);

  // Stream idle detection state
  const [streamStatus, setStreamStatus] = useState<"idle" | "streaming" | "stalled" | "recovering">("idle");
  const streamIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const retryCountRef = useRef<number>(0);

  const eventIdCounter = useRef(0);

  const genId = useCallback((prefix: string) => {
    eventIdCounter.current += 1;
    return `${prefix}_${Date.now()}_${eventIdCounter.current}`;
  }, []);

  // ── Errors (defined early to avoid TDZ in resetStreamIdleTimer) ──

  const addError = useCallback((err: Omit<StructuredError, "id" | "timestamp">): string => {
    const id = genId("err");
    setErrors(prev => [...prev, { ...err, id, timestamp: Date.now() }]);
    return id;
  }, [genId]);

  // ── Stream Idle Detection ─────────────────────────────────

  // Callback ref for recovery action - set by App.tsx
  const onRecoveryRef = useRef<(() => void) | null>(null);
  const setRecoveryCallback = useCallback((cb: (() => void) | null) => {
    onRecoveryRef.current = cb;
  }, []);

  const clearStreamIdleTimer = useCallback(() => {
    if (streamIdleTimerRef.current) {
      clearTimeout(streamIdleTimerRef.current);
      streamIdleTimerRef.current = null;
    }
  }, []);

  const resetStreamIdleTimer = useCallback(() => {
    clearStreamIdleTimer();
    lastActivityRef.current = Date.now();

    if (!isProcessing || streamStatus === "stalled") return;

    // Set stall warning timer (30s)
    streamIdleTimerRef.current = setTimeout(() => {
      const idleTime = Date.now() - lastActivityRef.current;
      if (idleTime >= STALL_THRESHOLD_MS && isProcessing) {
        setStreamStatus("stalled");
      }

      // Set auto-recovery timer (90s total)
      streamIdleTimerRef.current = setTimeout(() => {
        const totalIdleTime = Date.now() - lastActivityRef.current;
        if (totalIdleTime >= STREAM_IDLE_TIMEOUT_MS && isProcessing) {
          if (retryCountRef.current < MAX_RETRIES) {
            retryCountRef.current++;
            setStreamStatus("recovering");
            // Trigger recovery callback
            if (onRecoveryRef.current) {
              onRecoveryRef.current();
            }
          } else {
            setIsProcessing(false);
            setStreamStatus("idle");
            addError({ severity: "error", title: "Stream timeout", cause: "Model response timeout after " + MAX_RETRIES + " retries", retryable: false });
          }
        }
      }, STREAM_IDLE_TIMEOUT_MS - STALL_THRESHOLD_MS);
    }, STALL_THRESHOLD_MS);
  }, [isProcessing, streamStatus, clearStreamIdleTimer, addError]);

  // Reset retry count when processing starts
  useEffect(() => {
    if (isProcessing) {
      retryCountRef.current = 0;
      setStreamStatus("streaming");
      resetStreamIdleTimer();
    } else {
      clearStreamIdleTimer();
      setStreamStatus("idle");
    }

    return () => clearStreamIdleTimer();
  }, [isProcessing, clearStreamIdleTimer, resetStreamIdleTimer]);

  // ── Status (derived) ────────────────────────────────────────
  const status: StatusInfo = useMemo(() => ({
    model: meta.modelName,
    directory: meta.directory,
    branch: meta.branch,
    permissions: "normal",
    taskStatus: streamStatus === "stalled" ? "stalled" : isProcessing ? "running" : "idle",
    backgroundProcesses: longTasks.filter(t => t.status === "running").length,
    pendingApprovals: approvals.filter(a => a.status === "pending").length,
    streamStatus,
  }), [meta, isProcessing, streamStatus, longTasks, approvals]);

  // ── Event Stream ────────────────────────────────────────────

  const addEvent = useCallback((
    type: StreamEvent["type"],
    title: string,
    opts?: {
      detail?: string;
      severity?: EventSeverity;
      toolName?: string;
      collapsed?: boolean;
      durationMs?: number;
      lane?: StreamEvent["lane"];
    }
  ): string => {
    const id = genId(type);
    // A6: Auto-assign lane based on event type if not specified
    const toolName = opts?.toolName;
    const autoLane: StreamEvent["lane"] = opts?.lane ?? (
      type === "system" ? "system" :
      type === "error" ? "notification" :
      toolName && ["shell_execute", "file_write", "file_edit"].includes(toolName) ? "background" :
      "main"
    );
    const event: StreamEvent = {
      id,
      timestamp: Date.now(),
      type,
      title,
      detail: opts?.detail,
      severity: opts?.severity ?? "info",
      collapsed: opts?.collapsed ?? true,
      toolName: opts?.toolName,
      durationMs: opts?.durationMs,
      lane: autoLane,
    };
    setEvents(prev => [...prev, event]);
    return id;
  }, [genId]);

  const updateEvent = useCallback((id: string, patch: Partial<StreamEvent>) => {
    setEvents(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  }, []);

  const appendToEvent = useCallback((id: string, text: string) => {
    setEvents(prev => prev.map(e =>
      e.id === id ? { ...e, title: e.title + text } : e
    ));
  }, []);

  const toggleEventCollapse = useCallback((id: string) => {
    setEvents(prev => prev.map(e =>
      e.id === id ? { ...e, collapsed: !e.collapsed } : e
    ));
  }, []);

  // ── Approval System ─────────────────────────────────────────

  const addApproval = useCallback((req: Omit<ApprovalRequest, "id" | "timestamp" | "status">): string => {
    const id = genId("approval");
    setApprovals(prev => [...prev, {
      ...req,
      id,
      timestamp: Date.now(),
      status: "pending",
    }]);
    return id;
  }, [genId]);

  const resolveApproval = useCallback((id: string, decision: "approved" | "rejected") => {
    setApprovals(prev => prev.map(a =>
      a.id === id ? { ...a, status: decision } : a
    ));
  }, []);

  // ── Plan ────────────────────────────────────────────────────

  const updatePlan = useCallback((updater: (prev: PlanState | null) => PlanState | null) => {
    setPlan(updater);
  }, []);

  // ── Diffs ───────────────────────────────────────────────────

  const addDiff = useCallback((diff: DiffFile) => {
    setDiffs(prev => {
      const existing = prev.findIndex(d => d.path === diff.path);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = diff;
        return next;
      }
      return [...prev, diff];
    });
  }, []);

  const clearDiffs = useCallback(() => setDiffs([]), []);

  // ── Long Tasks ──────────────────────────────────────────────

  const startLongTask = useCallback((name: string, phase: string): string => {
    const id = genId("task");
    setLongTasks(prev => [...prev, {
      id, name, phase, status: "running", startedAt: Date.now(),
    }]);
    return id;
  }, [genId]);

  const updateLongTask = useCallback((id: string, patch: Partial<LongTask>) => {
    setLongTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  // A2: Update task progress specifically
  const updateTaskProgress = useCallback((id: string, progress: number, output?: string) => {
    setLongTasks(prev => prev.map(t =>
      t.id === id ? { ...t, progress: Math.max(0, Math.min(1, progress)), output: output ?? t.output } : t
    ));
  }, []);

  // A2: Append output to a running task
  const appendTaskOutput = useCallback((id: string, output: string) => {
    setLongTasks(prev => prev.map(t =>
      t.id === id ? { ...t, output: (t.output ?? "") + output } : t
    ));
  }, []);

  // ── Context ─────────────────────────────────────────────────

  const addActiveFile = useCallback((path: string) => {
    setContext(prev => ({
      ...prev,
      activeFiles: prev.activeFiles.includes(path)
        ? prev.activeFiles
        : [...prev.activeFiles, path],
    }));
  }, []);

  const addRecentFile = useCallback((path: string) => {
    setContext(prev => ({
      ...prev,
      recentFiles: prev.recentFiles.includes(path)
        ? prev.recentFiles
        : [...prev.recentFiles.slice(-19), path],
    }));
  }, []);

  // ── Input History ───────────────────────────────────────────

  const pushHistory = useCallback((msg: string) => {
    setInputHistory(prev => [...prev.filter(h => h !== msg), msg].slice(-50));
  }, []);

  // ── Reset ───────────────────────────────────────────────────

  const clearScreen = useCallback(() => {
    setEvents([]);
    setErrors([]);
    setSelectedEventIdx(-1);
  }, []);

  // ── Navigate Events (j/k) ──────────────────────────────────

  const scrollEvent = useCallback((direction: 1 | -1) => {
    setSelectedEventIdx(prev => {
      const len = events.length;
      if (len === 0) return -1;
      const next = prev + direction;
      if (next < 0) return 0;
      if (next >= len) return len - 1;
      return next;
    });
  }, [events.length]);

  return {
    // State
    mode, events, approvals, plan, diffs, errors, longTasks,
    context, status, isProcessing, inputHistory, selectedEventIdx,
    streamStatus, retryCount: retryCountRef.current,
    // A4: Plan mode state
    isPlanMode,
    // Setters
    setMode, setIsProcessing,
    // Stream idle detection
    setRecoveryCallback, resetStreamIdleTimer,
    // Event stream
    addEvent, updateEvent, appendToEvent, toggleEventCollapse,
    // Approvals
    addApproval, resolveApproval,
    // Plan
    updatePlan,
    // Diffs
    addDiff, clearDiffs,
    // Errors
    addError,
    // Long tasks
    startLongTask, updateLongTask, updateTaskProgress, appendTaskOutput,
    // Context
    addActiveFile, addRecentFile, setContext,
    // Input
    pushHistory,
    // Navigation
    scrollEvent, setSelectedEventIdx,
    // Actions
    clearScreen,
  };
}

export type TuiStateAPI = ReturnType<typeof useTuiState>;
