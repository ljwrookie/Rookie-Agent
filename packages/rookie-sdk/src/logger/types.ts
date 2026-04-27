/**
 * Structured logging types for Rookie Agent SDK.
 *
 * Design goals:
 *  - Zero runtime dependencies (so SDK stays lean). If `pino` is installed in the
 *    host app, callers can plug it in via {@link LoggerOptions.sink}; otherwise
 *    we fall back to a built-in JSONL writer.
 *  - Fields aligned with the P0-T2 spec:
 *    `ts, level, sessionId, agent, tool, duration, tokens, cost, msg`.
 *  - Daily rotation (`log/app.YYYY-MM-DD.log.jsonl`).
 */

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/** Fields any log record MAY carry. `msg` and `level` are mandatory at emit-time. */
export interface LogFields {
  /** ISO-8601 timestamp. Filled by logger. */
  ts?: string;
  level?: LogLevel;
  sessionId?: string;
  agent?: string;
  tool?: string;
  /** Wall-clock duration in ms, e.g. for tool invocations. */
  duration?: number;
  /** Prompt + completion token count (sum or split object). */
  tokens?: number | { prompt?: number; completion?: number; total?: number };
  /** USD cost estimate. */
  cost?: number;
  /** Free-form key/values. */
  [key: string]: unknown;
}

export interface LogRecord extends LogFields {
  ts: string;
  level: LogLevel;
  msg: string;
}

/**
 * Pluggable sink. Called with an already-serialised record. Implementations
 * MUST be synchronous-ish (returning void or Promise<void>); exceptions are
 * swallowed by {@link Logger} to avoid cascading failures.
 */
export type LogSink = (record: LogRecord, line: string) => void | Promise<void>;

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to "info". */
  level?: LogLevel;
  /** Static fields merged into every record (e.g. sessionId). */
  base?: LogFields;
  /**
   * Directory where daily JSONL files are written. Defaults to `./log`.
   * Set to `null` to disable file output entirely.
   */
  dir?: string | null;
  /** File base name, resulting in `<baseName>.YYYY-MM-DD.log.jsonl`. Default `app`. */
  baseName?: string;
  /** Extra sink (e.g. stdout, pino instance). */
  sink?: LogSink;
  /** Override clock for tests. */
  now?: () => Date;
}
