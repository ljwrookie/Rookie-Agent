import { RookieClient } from "../client.js";
import { ToolRegistry } from "../tools/registry.js";
import { MemoryStore } from "../memory/store.js";
import { ModelProvider } from "../models/types.js";

// ─── Multi-Agent Collaboration Types (Phase-D) ───────────────────

/** Subagent execution mode - three paths like CCB */
export type SubagentMode = "in-process" | "child" | "remote";

/** Agent communication message */
export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: "task" | "result" | "status" | "cancel" | "heartbeat";
  payload: unknown;
  timestamp: number;
  correlationId?: string;  // For request/response pairing
}

/** Worktree configuration for git isolation */
export interface WorktreeConfig {
  enabled: boolean;
  path?: string;           // Custom worktree path (auto-generated if not provided)
  branch?: string;         // Branch to create worktree from
  keepOnComplete?: boolean; // Don't delete worktree after task
  /** D2: Sparse checkout paths - only checkout these directories */
  sparsePaths?: string[];
  /** D2: Cherry-pick changes back to main branch on completion */
  cherryPickOnComplete?: boolean;
}

/** Resource limits for subagent */
export interface ResourceLimits {
  maxMemoryMB?: number;
  maxCpuPercent?: number;
  maxFileDescriptors?: number;
  maxProcesses?: number;
}

/** Agent telemetry/metrics */
export interface AgentMetrics {
  agentId: string;
  startTime: number;
  endTime?: number;
  toolCalls: number;
  tokensUsed: number;
  messagesExchanged: number;
  errors: number;
  duration: number;
}

/** Task delegation protocol */
export interface TaskDelegation {
  taskId: string;
  parentAgentId: string;
  childAgentId: string;
  task: string;
  constraints: {
    timeout: number;
    maxRetries: number;
    allowedTools: string[];
    resourceLimits?: ResourceLimits;
  };
  priority: "critical" | "high" | "normal" | "low";
}

// ─── Agent Interface ─────────────────────────────────────────────

export interface Agent {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[]; // tool names
  run(input: AgentInput, context: AgentContext): AsyncGenerator<AgentEvent>;
}

// ─── Input / Context ─────────────────────────────────────────────

export interface AgentInput {
  message: string;
  history: Message[];
}

export interface AgentContext {
  client: RookieClient;
  model: ModelProvider;
  memory: MemoryStore;
  tools: ToolRegistry;
  // v2 additions — optional until Phase 1 modules are implemented
  hooks?: import("../hooks/registry.js").HookRegistry;  // HookRegistry (Phase 1)
  harness?: unknown;          // SessionHarness (Phase 2)
  instructions?: unknown;     // ProjectInstructions (Phase 1)
  permissions?: unknown;      // PermissionManager (Phase 1)
  /**
   * Optional Compactor (P1-T3). When present, `runReAct` calls
   * `maybeCompact(messages)` before each model request.
   */
  compactor?: unknown;        // Compactor (P1-T3)
  /** Session ID for hook context */
  sessionId?: string;
  /** Project root for hook context */
  projectRoot?: string;
  /** B10.2: Callback when agent needs to ask user a question */
  onAskUser?: (question: string, options?: string[], defaultValue?: string) => Promise<string>;
}

// ─── Message Types ───────────────────────────────────────────────

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  tool_call_id?: string;
  /** B6: Metadata for pipeline tracking */
  metadata?: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  params: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: string;
  output: string;
  error?: string;
}

// ─── Events (v2: finer granularity + streaming support) ──────────

export type AgentEvent =
  | { type: "thinking"; content: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; result: ToolResult; duration?: number }
  | { type: "response"; content: string; done?: boolean }  // done=false → streaming chunk
  | { type: "error"; error: string }
  | { type: "checkpoint"; progress: unknown }    // SessionHarness (Phase 2)
  | { type: "skill_invoked"; skill: string }     // Skill system (Phase 2)
  | { type: "hook_fired"; hook: string }         // Hooks (Phase 1)
  | { type: "system_message"; content: string }  // System notifications (P2-T1)
  | {
      type: "compacted";                         // Context compaction (P1-T3)
      reason: "threshold" | "manual";
      before: { messages: number; tokens: number };
      after: { messages: number; tokens: number };
      summaryId?: string;
    }
  | {
      type: "user_question";                      // B10.2: Ask user question
      question: string;
      options?: string[];
      defaultValue?: string;
      id: string;
    }
  | {
      type: "user_question_answer";                // B10.2: User answered
      id: string;
      answer: string;
    };

// ─── ReAct Step (internal) ───────────────────────────────────────

export interface ReActStep {
  thought: string;
  action?: ToolCall;
  observation?: string;
}
