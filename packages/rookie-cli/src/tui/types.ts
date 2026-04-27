// ─── TUI Types ────────────────────────────────────────────────────
// Shared type definitions for the redesigned TUI
// Information Architecture: P0 (decisions/errors) → P1 (status/results) → P2 (logs) → P3 (history)

import type { ToolCall } from "@rookie/agent-sdk";

// ── Modes ────────────────────────────────────────────────────────

export type TuiMode = "chat" | "plan" | "diff" | "logs" | "review" | "approve" | "agents" | "question";

// ── Event Stream Items ──────────────────────────────────────────

export type EventSeverity = "info" | "success" | "warning" | "error";

// A6: Event lanes for multi-lane display
export type EventLane = "main" | "system" | "background" | "notification";

export interface StreamEvent {
  id: string;
  timestamp: number;
  type: "intent" | "action" | "result" | "error" | "system" | "user";
  title: string;           // one-line summary
  detail?: string;         // expandable detail
  severity: EventSeverity;
  durationMs?: number;
  collapsed: boolean;
  toolName?: string;
  children?: StreamEvent[]; // nested events (e.g. tool call + result pair)
  lane?: EventLane;        // A6: lane classification for multi-lane display
}

// ── Approval System ─────────────────────────────────────────────

export type ApprovalAction = "shell_execute" | "file_write" | "file_edit" | "git_push" | "network" | "other";
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface ApprovalRequest {
  id: string;
  timestamp: number;
  action: ApprovalAction;
  scope: string;           // file path, command, URL
  riskLevel: RiskLevel;
  description: string;
  detail?: string;         // full command or diff preview
  status: "pending" | "approved" | "rejected" | "edited";
  toolCall?: ToolCall;
}

// ── User Question System (B10.2) ────────────────────────────────

export interface UserQuestionRequest {
  id: string;
  timestamp: number;
  question: string;
  options?: string[];
  defaultValue?: string;
  status: "pending" | "answered" | "timedout";
  answer?: string;
  toolCall?: ToolCall;
}

// ── Plan ────────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  title: string;
  status: "pending" | "active" | "done" | "error" | "skipped";
  durationMs?: number;
  detail?: string;
}

export interface PlanState {
  title: string;
  steps: PlanStep[];
  completionPct: number;   // 0..100
}

// ── Diff ────────────────────────────────────────────────────────

export interface DiffHunk {
  file: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
  approved?: boolean;
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
  lineNo?: number;
}

export interface DiffFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  hunks: DiffHunk[];
  approved?: boolean;
}

// ── Error Display ───────────────────────────────────────────────

export interface StructuredError {
  id: string;
  timestamp: number;
  severity: "warning" | "error" | "fatal";
  title: string;
  cause?: string;
  suggestion?: string;
  retryable: boolean;
  raw?: string;
}

// ── Long Task ───────────────────────────────────────────────────

export interface LongTask {
  id: string;
  name: string;
  phase: string;
  status: "running" | "done" | "error" | "cancelled";
  startedAt: number;
  durationMs?: number;
  output?: string;         // streaming output
  progress?: number;       // 0..1
}

// ── Context Awareness ───────────────────────────────────────────

export interface WorkspaceContext {
  directory: string;
  gitBranch?: string;
  gitDirty: boolean;
  recentFiles: string[];
  activeFiles: string[];   // files touched in this session
  taskCount: { total: number; done: number; pending: number };
}

// ── Status Bar ──────────────────────────────────────────────────

export interface StatusInfo {
  model: string;
  directory: string;
  branch?: string;
  permissions: "strict" | "normal" | "permissive";
  taskStatus: string;
  backgroundProcesses: number;
  pendingApprovals: number;
  pendingQuestions?: number;
  streamStatus?: "idle" | "streaming" | "stalled" | "recovering";
}

// ── D8: Multi-Agent State ───────────────────────────────────────

export interface AgentStatus {
  id: string;
  name: string;
  state: "idle" | "running" | "done" | "error";
  taskSummary: string;
  tokensUsed: number;
  toolCalls: number;
  startTime?: number;
  duration?: number;
  progress?: number; // 0..1
}

export interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
  type: "task" | "result" | "status" | "broadcast";
}

// ── App State ───────────────────────────────────────────────────

export interface TuiState {
  mode: TuiMode;
  events: StreamEvent[];
  approvals: ApprovalRequest[];
  plan: PlanState | null;
  diffs: DiffFile[];
  errors: StructuredError[];
  longTasks: LongTask[];
  context: WorkspaceContext;
  status: StatusInfo;
  isProcessing: boolean;
  inputHistory: string[];
  selectedEventIdx: number;
  // D8: Multi-agent state
  agents: AgentStatus[];
  mailbox: MailboxMessage[];
  selectedAgentId?: string;
}

// ── Keyboard ────────────────────────────────────────────────────

export interface KeyBinding {
  key: string;
  description: string;
  mode?: TuiMode | "global";
}

export const KEY_BINDINGS: KeyBinding[] = [
  { key: "Enter", description: "Send message", mode: "global" },
  { key: "Shift+Enter", description: "New line", mode: "global" },
  { key: "Ctrl+C", description: "Interrupt / Cancel", mode: "global" },
  { key: "Ctrl+L", description: "Clear screen", mode: "global" },
  { key: "Ctrl+A", description: "Agent panel", mode: "global" },
  { key: "/", description: "Command palette", mode: "global" },
  { key: "Tab", description: "Autocomplete", mode: "global" },
  { key: "j/k", description: "Scroll events", mode: "chat" },
  { key: "o", description: "Open file", mode: "chat" },
  { key: "d", description: "View diff", mode: "chat" },
  { key: "l", description: "Expand logs", mode: "chat" },
  { key: "r", description: "Retry", mode: "chat" },
  { key: "a", description: "Approve", mode: "approve" },
];

// ── Color Semantics ─────────────────────────────────────────────
// A3: Theme-aware colors (defaults to dark theme)

export const COLORS = {
  // Neutral
  text: "white",
  textDim: "gray",
  border: "gray",
  background: "black",
  // System
  system: "cyan",
  link: "blue",
  // Feedback
  success: "green",
  warning: "yellow",
  error: "red",
  fatal: "redBright",
  // Accents
  user: "green",
  assistant: "cyan",
  toolName: "magenta",
  modeBadge: "blueBright",
  // A3: Theme-specific
  spinner: "yellow",
  progressBar: "cyan",
  progressTrack: "gray",
} as const;

// A3: Re-export theme types for convenience
export type { ThemeName, ThemeColors, Theme } from "./theme.js";
