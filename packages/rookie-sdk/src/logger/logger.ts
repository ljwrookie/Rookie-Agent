import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  LOG_LEVEL_ORDER,
  type LogFields,
  type LogLevel,
  type LogRecord,
  type LogSink,
  type LoggerOptions,
} from "./types.js";

/**
 * Lightweight structured logger.
 *
 * Emits newline-delimited JSON to a daily-rotated file and/or a custom sink.
 * Safe against I/O errors — any failure inside a sink is caught and printed
 * to `process.stderr` once, never rethrown.
 *
 * Usage:
 * ```ts
 * const log = new Logger({ dir: "log", base: { sessionId: "s1" } });
 * log.info("session.start");
 * log.info("tool.invoke", { tool: "file_read", duration: 12 });
 * ```
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly base: LogFields;
  private readonly dir: string | null;
  private readonly baseName: string;
  private readonly sink: LogSink | undefined;
  private readonly now: () => Date;

  private fileReady = false;
  private fileFailed = false;

  constructor(opts: LoggerOptions = {}) {
    this.level = opts.level ?? "info";
    this.base = { ...(opts.base ?? {}) };
    this.dir = opts.dir === undefined ? "log" : opts.dir;
    this.baseName = opts.baseName ?? "app";
    this.sink = opts.sink;
    this.now = opts.now ?? (() => new Date());
  }

  /** Create a child logger that inherits options but layers extra base fields. */
  child(extra: LogFields): Logger {
    return new Logger({
      level: this.level,
      base: { ...this.base, ...extra },
      dir: this.dir,
      baseName: this.baseName,
      sink: this.sink,
      now: this.now,
    });
  }

  trace(msg: string, fields?: LogFields): void { this.log("trace", msg, fields); }
  debug(msg: string, fields?: LogFields): void { this.log("debug", msg, fields); }
  info(msg: string, fields?: LogFields):  void { this.log("info",  msg, fields); }
  warn(msg: string, fields?: LogFields):  void { this.log("warn",  msg, fields); }
  error(msg: string, fields?: LogFields): void { this.log("error", msg, fields); }
  fatal(msg: string, fields?: LogFields): void { this.log("fatal", msg, fields); }

  /** Emit a log record if its level meets the threshold. */
  log(level: LogLevel, msg: string, fields?: LogFields): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.level]) return;

    const record: LogRecord = {
      ...this.base,
      ...(fields ?? {}),
      ts: this.now().toISOString(),
      level,
      msg,
    };

    const line = JSON.stringify(record);

    if (this.dir && !this.fileFailed) {
      this.writeToFile(line);
    }

    if (this.sink) {
      try {
        const p = this.sink(record, line);
        if (p && typeof (p as Promise<void>).catch === "function") {
          (p as Promise<void>).catch((err) => Logger.warnOnce("logger sink rejected: " + String(err)));
        }
      } catch (err) {
        Logger.warnOnce("logger sink threw: " + String(err));
      }
    }
  }

  private writeToFile(line: string): void {
    try {
      if (!this.fileReady) {
        mkdirSync(this.dir as string, { recursive: true });
        this.fileReady = true;
      }
      const date = this.now().toISOString().slice(0, 10); // YYYY-MM-DD
      const file = join(this.dir as string, `${this.baseName}.${date}.log.jsonl`);
      appendFileSync(file, line + "\n", { encoding: "utf-8" });
    } catch (err) {
      this.fileFailed = true;
      Logger.warnOnce("logger file write failed: " + String(err));
    }
  }

  /** Compute the file path that would be written right now (useful for tests). */
  currentFile(): string | null {
    if (!this.dir) return null;
    const date = this.now().toISOString().slice(0, 10);
    return join(this.dir, `${this.baseName}.${date}.log.jsonl`);
  }

  private static warnedMessages = new Set<string>();
  private static warnOnce(msg: string): void {
    if (Logger.warnedMessages.has(msg)) return;
    Logger.warnedMessages.add(msg);
    try { process.stderr.write(`[rookie-logger] ${msg}\n`); } catch { /* noop */ }
  }
}

/** Parse a JSON-RPC `log.event` notification's params into a LogRecord. */
export function parseLogEvent(params: unknown): LogRecord | null {
  if (!params || typeof params !== "object") return null;
  const p = params as Record<string, unknown>;
  if (typeof p.msg !== "string") return null;
  const level = typeof p.level === "string" ? (p.level as LogLevel) : "info";
  const ts = typeof p.ts === "string" ? p.ts : new Date().toISOString();
  return { ...p, ts, level, msg: p.msg } as LogRecord;
}
