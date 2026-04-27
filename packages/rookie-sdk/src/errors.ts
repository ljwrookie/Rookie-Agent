/**
 * Unified error types for Rookie Agent.
 * All modules should throw/catch RookieError instances.
 */

export enum ErrorCode {
  // General
  UNKNOWN = "UNKNOWN",
  TIMEOUT = "TIMEOUT",
  CANCELLED = "CANCELLED",

  // Transport
  TRANSPORT_DISCONNECTED = "TRANSPORT_DISCONNECTED",
  TRANSPORT_TIMEOUT = "TRANSPORT_TIMEOUT",
  TRANSPORT_PARSE_ERROR = "TRANSPORT_PARSE_ERROR",

  // Model / LLM
  MODEL_API_ERROR = "MODEL_API_ERROR",
  MODEL_RATE_LIMIT = "MODEL_RATE_LIMIT",
  MODEL_CONTEXT_LENGTH = "MODEL_CONTEXT_LENGTH",
  MODEL_NOT_FOUND = "MODEL_NOT_FOUND",

  // Tool
  TOOL_NOT_FOUND = "TOOL_NOT_FOUND",
  TOOL_EXECUTION_ERROR = "TOOL_EXECUTION_ERROR",
  TOOL_PERMISSION_DENIED = "TOOL_PERMISSION_DENIED",
  TOOL_TIMEOUT = "TOOL_TIMEOUT",
  TOOL_BLOCKED = "TOOL_BLOCKED",

  // Agent
  AGENT_MAX_ITERATIONS = "AGENT_MAX_ITERATIONS",
  AGENT_ABORTED = "AGENT_ABORTED",

  // File / IO
  FILE_NOT_FOUND = "FILE_NOT_FOUND",
  FILE_PERMISSION_DENIED = "FILE_PERMISSION_DENIED",
  FILE_READ_ERROR = "FILE_READ_ERROR",
  FILE_WRITE_ERROR = "FILE_WRITE_ERROR",

  // Memory
  MEMORY_DB_ERROR = "MEMORY_DB_ERROR",

  // Hook
  HOOK_REJECTED = "HOOK_REJECTED",
  HOOK_TIMEOUT = "HOOK_TIMEOUT",
}

export class RookieError extends Error {
  readonly code: ErrorCode;
  readonly context?: Record<string, unknown>;
  readonly cause?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { cause?: Error; context?: Record<string, unknown> }
  ) {
    super(message);
    this.name = "RookieError";
    this.code = code;
    this.cause = options?.cause;
    this.context = options?.context;
  }

  /** Is this a retryable error? */
  get retryable(): boolean {
    return [
      ErrorCode.TIMEOUT,
      ErrorCode.TRANSPORT_TIMEOUT,
      ErrorCode.MODEL_RATE_LIMIT,
      ErrorCode.TOOL_TIMEOUT,
      ErrorCode.HOOK_TIMEOUT,
    ].includes(this.code);
  }

  /** Is this a user-facing error (should be shown to user)? */
  get userFacing(): boolean {
    return [
      ErrorCode.TOOL_PERMISSION_DENIED,
      ErrorCode.TOOL_BLOCKED,
      ErrorCode.HOOK_REJECTED,
      ErrorCode.FILE_NOT_FOUND,
      ErrorCode.MODEL_RATE_LIMIT,
      ErrorCode.MODEL_CONTEXT_LENGTH,
    ].includes(this.code);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}
