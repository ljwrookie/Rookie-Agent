// Hook lifecycle types (from Claude Code)

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "OnToolError"
  | "SessionStart"
  | "SessionEnd"
  | "UserPromptSubmit"
  | "Stop"
  | "PreCheckpoint"
  | "PostCheckpoint"
  | "PreCompact"
  | "PostCompact"
  | "OnPermissionAsk"
  | "OnSkillProposed"
  // C7: New events for subagent lifecycle and proactive monitoring
  | "SubagentStart"
  | "SubagentStop"
  | "TeammateIdle"
  | "ProactiveTick";

/** Hook priority levels - higher number = higher priority */
export type HookPriority = "critical" | "high" | "normal" | "low" | "background";

export const HOOK_PRIORITY_VALUE: Record<HookPriority, number> = {
  critical: 100,
  high: 75,
  normal: 50,
  low: 25,
  background: 0,
};

/** Trust level for hook execution */
export type HookTrustLevel = "trusted" | "untrusted" | "verified";

/** Hook execution mode */
export type HookExecutionMode = "blocking" | "nonBlocking" | "asyncRewake";

export interface HookConfig {
  event: HookEvent;
  matcher?: string;           // tool name pattern (only *ToolUse events)
  command?: string;           // shell command
  url?: string;               // HTTP webhook
  /** HTTP method for url hooks; defaults to POST. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Extra HTTP headers merged on top of `content-type: application/json`. */
  headers?: Record<string, string>;
  /** Retry attempts for url hooks on network / 5xx error. Default 0. */
  retries?: number;
  prompt?: string;            // LLM prompt template
  /** Optional model hint the prompt runner can pass to the router. */
  model?: string;
  timeout?: number;           // ms, default 30000
  blocking?: boolean;         // default true; false = fire-and-forget
  canReject?: boolean;        // only Pre* events

  // === Phase-C Enhancements ===
  /** Hook priority - determines execution order. Default: "normal" */
  priority?: HookPriority;
  /** Trust level for this hook. Default: "untrusted" */
  trustLevel?: HookTrustLevel;
  /** Execution mode. Default: "blocking" */
  mode?: HookExecutionMode;
  /** Condition expression - hook only executes when this evaluates to true */
  condition?: string;
  /** Transform: modify input before passing to next hook/tool */
  transform?: (input: unknown, context: HookContext) => unknown | Promise<unknown>;
  /** Filter: return true to allow, false to block */
  filter?: (context: HookContext) => boolean | Promise<boolean>;
  /** Whether this hook can modify the input (for PreToolUse). Default: false */
  canModifyInput?: boolean;
  /** Whether to skip this hook if previous hooks rejected. Default: false */
  skipIfRejected?: boolean;
  /** C2: Whether to use structured JSON output for LLM hooks */
  structuredOutput?: boolean;
  // C4: Dedup configuration
  /** Whether to enable deduplication for this hook. Default: true */
  dedup?: boolean;
  /** Custom dedup key generator. Default: uses event + matcher + input hash */
  dedupKey?: (context: HookContext) => string;
}

export interface HookContext {
  sessionId: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  projectRoot: string;
  /** Populated for `OnPermissionAsk`: how the user ultimately responded. */
  permissionDecision?: {
    allowed: boolean;
    remember?: "once" | "session" | "forever";
  };
  /**
   * Populated for `PreCompact` / `PostCompact`:
   *   - `reason`    : "threshold" (auto) or "manual" (/compact)
   *   - `before`    : token/message counts before compaction
   *   - `after`     : token/message counts after compaction (PostCompact only)
   *   - `summaryId` : CuratedMemory id where the summary was stored (PostCompact)
   */
  compaction?: {
    reason: "threshold" | "manual";
    before: { messages: number; tokens: number };
    after?: { messages: number; tokens: number };
    summaryId?: string;
  };
  /**
   * Populated for `OnSkillProposed`:
   *   - `candidate` : The proposed skill candidate
   *   - `approved`  : Set by hook to approve/reject the proposal
   */
  skillProposal?: {
    candidate: {
      name: string;
      description: string;
      prompt: string;
      tools: string[];
    };
    approved?: boolean;
  };
  /**
   * Populated for `OnToolError`:
   *   - `error`     : The error that occurred
   *   - `toolName`  : Name of the tool that failed
   *   - `toolInput` : Input that caused the error
   */
  toolError?: {
    error: Error;
    toolName: string;
    toolInput: Record<string, unknown>;
  };
  /**
   * Modified input from transform hooks (PreToolUse).
   * Hooks can set this to modify the tool input.
   */
  modifiedInput?: Record<string, unknown>;
  /**
   * Trust decision from trust hooks.
   */
  trustDecision?: {
    trusted: boolean;
    reason?: string;
  };
}

export interface HookResult {
  hook: HookConfig;
  success: boolean;
  output?: string;
  rejected?: boolean;
  duration: number;
  /** Modified input from transform hooks */
  modifiedInput?: unknown;
  /** Whether this hook was skipped due to condition/filter */
  skipped?: boolean;
  /** Skip reason if skipped */
  skipReason?: string;
  /** C2: Structured decision from LLM hook */
  decision?: HookLLMDecision;
  // C1: Async rewake fields
  /** Whether this hook is async and needs rewake */
  async?: boolean;
  /** Token to use for rewaking this hook */
  rewakeToken?: string;
  /** C3: Modified output for PostToolUse hooks */
  modifiedOutput?: string;
}

/** C1: Async hook pending result */
export interface PendingAsyncHook {
  token: string;
  hook: HookConfig;
  context: HookContext;
  startTime: number;
  resolve: (result: HookResult) => void;
  reject: (error: Error) => void;
}

/** C2: Structured LLM hook decision output */
export interface HookLLMDecision {
  /** Whether the operation is allowed */
  decision: "allow" | "reject";
  /** Reason for the decision */
  reason: string;
  /** Optional modified input for transform hooks */
  modifiedInput?: Record<string, unknown>;
}

/** Hook chain result - aggregate result from multiple hooks */
export interface HookChainResult {
  results: HookResult[];
  /** Final modified input after all transform hooks */
  finalInput?: unknown;
  /** Whether any hook rejected */
  rejected: boolean;
  /** Total execution duration */
  totalDuration: number;
}
