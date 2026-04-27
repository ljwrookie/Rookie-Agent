/**
 * Transcript Persistence (D5)
 *
 * Records complete conversation history (including tool calls) to JSONL files.
 * Supports session resume and forking.
 */

import { promises as fs } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import type { Message, ToolCall, ToolResult } from "../agent/types.js";

// Transcripts directory
const TRANSCRIPTS_DIR = join(homedir(), ".rookie", "transcripts");

// Transcript record types
export interface TranscriptRecord {
  timestamp: number;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  metadata?: Record<string, unknown>;
}

export interface TranscriptSession {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  projectRoot?: string;
  records: TranscriptRecord[];
  forkedFrom?: string;  // Parent session ID if this is a fork
}

export interface TranscriptOptions {
  sessionId?: string;
  projectRoot?: string;
  forkFrom?: string;  // Fork from another session
}

/**
 * TranscriptManager: Manages session transcript persistence.
 * D5: Transcript persistence + /resume
 */
export class TranscriptManager {
  private sessionId: string;
  private projectRoot?: string;
  private records: TranscriptRecord[] = [];
  private filePath: string;
  private forkedFrom?: string;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(options: TranscriptOptions = {}) {
    this.sessionId = options.sessionId || this.generateSessionId();
    this.projectRoot = options.projectRoot;
    this.forkedFrom = options.forkFrom;
    this.filePath = join(TRANSCRIPTS_DIR, `${this.sessionId}.jsonl`);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Initialize the transcript manager.
   * Creates directory and loads forked history if applicable.
   */
  async init(): Promise<void> {
    // Ensure transcripts directory exists
    await fs.mkdir(TRANSCRIPTS_DIR, { recursive: true });

    // If forking, load parent history
    if (this.forkedFrom) {
      const parentRecords = await this.loadTranscript(this.forkedFrom);
      this.records = [...parentRecords];

      // Add fork marker
      this.records.push({
        timestamp: Date.now(),
        role: "system",
        content: `Forked from session ${this.forkedFrom}`,
        metadata: { type: "fork", parentSessionId: this.forkedFrom },
      });

      await this.flush();
    }

    // Write session header
    const header: Record<string, unknown> = {
      type: "session_start",
      sessionId: this.sessionId,
      createdAt: Date.now(),
      projectRoot: this.projectRoot,
      forkedFrom: this.forkedFrom,
    };

    await fs.appendFile(this.filePath, JSON.stringify(header) + "\n");
  }

  /**
   * Record a message to the transcript.
   */
  record(record: Omit<TranscriptRecord, "timestamp">): void {
    const fullRecord: TranscriptRecord = {
      ...record,
      timestamp: Date.now(),
    };

    this.records.push(fullRecord);

    // Debounced flush
    this.scheduleFlush();
  }

  /**
   * Record a user message.
   */
  recordUser(content: string, metadata?: Record<string, unknown>): void {
    this.record({ role: "user", content, metadata });
  }

  /**
   * Record an assistant message.
   */
  recordAssistant(content: string, toolCalls?: ToolCall[], metadata?: Record<string, unknown>): void {
    this.record({ role: "assistant", content, toolCalls, metadata });
  }

  /**
   * Record a tool result.
   */
  recordToolResult(result: ToolResult, metadata?: Record<string, unknown>): void {
    this.record({
      role: "tool",
      content: result.output,
      toolResults: [result],
      metadata,
    });
  }

  /**
   * Record a system message.
   */
  recordSystem(content: string, metadata?: Record<string, unknown>): void {
    this.record({ role: "system", content, metadata });
  }

  /**
   * Get all records.
   */
  getRecords(): TranscriptRecord[] {
    return [...this.records];
  }

  /**
   * Get records as Message array for context restoration.
   */
  getMessages(): Message[] {
    return this.records
      .filter((r) => r.role !== "tool" || r.toolResults)
      .map((r) => ({
        role: r.role,
        content: r.content,
        toolCalls: r.toolCalls,
        toolResults: r.toolResults,
      }));
  }

  /**
   * Flush records to disk immediately.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const lines = this.records.map((r) => JSON.stringify(r)).join("\n");
    if (lines) {
      await fs.appendFile(this.filePath, lines + "\n");
    }
  }

  /**
   * Close the transcript and write footer.
   */
  async close(): Promise<void> {
    await this.flush();

    const footer: Record<string, unknown> = {
      type: "session_end",
      sessionId: this.sessionId,
      endedAt: Date.now(),
      recordCount: this.records.length,
    };

    await fs.appendFile(this.filePath, JSON.stringify(footer) + "\n");
  }

  /**
   * Load a transcript from disk.
   */
  private async loadTranscript(sessionId: string): Promise<TranscriptRecord[]> {
    const filePath = join(TRANSCRIPTS_DIR, `${sessionId}.jsonl`);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      const records: TranscriptRecord[] = [];
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as TranscriptRecord | { type: string };
          // Skip header/footer records
          if ("type" in record && (record.type === "session_start" || record.type === "session_end")) {
            continue;
          }
          if ("role" in record) {
            records.push(record);
          }
        } catch {
          // Skip malformed lines
        }
      }

      return records;
    } catch {
      return [];
    }
  }

  /**
   * Schedule a debounced flush.
   */
  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.flush().catch(() => {
        // Ignore flush errors
      });
    }, 1000); // Flush after 1 second of inactivity
  }

  /**
   * Generate a unique session ID.
   */
  private generateSessionId(): string {
    const hash = createHash("sha256")
      .update(`${Date.now()}-${process.pid}-${Math.random()}`)
      .digest("hex")
      .slice(0, 16);
    return `session-${hash}`;
  }

  // ─── Static Methods ────────────────────────────────────

  /**
   * List all available transcripts.
   */
  static async listTranscripts(limit = 20): Promise<Array<{ sessionId: string; createdAt: number; recordCount: number }>> {
    await fs.mkdir(TRANSCRIPTS_DIR, { recursive: true });

    const files = await fs.readdir(TRANSCRIPTS_DIR);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    const transcripts: Array<{ sessionId: string; createdAt: number; recordCount: number }> = [];

    for (const file of jsonlFiles) {
      const sessionId = basename(file, ".jsonl");
      const filePath = join(TRANSCRIPTS_DIR, file);

      try {
        const stats = await fs.stat(filePath);
        const content = await fs.readFile(filePath, "utf-8");
        const recordCount = content.split("\n").filter((l) => l.trim()).length;

        transcripts.push({
          sessionId,
          createdAt: stats.birthtime.getTime(),
          recordCount,
        });
      } catch {
        // Skip files we can't read
      }
    }

    // Sort by creation time (newest first)
    transcripts.sort((a, b) => b.createdAt - a.createdAt);

    return transcripts.slice(0, limit);
  }

  /**
   * Resume a session from transcript.
   */
  static async resumeSession(sessionId: string): Promise<{ messages: Message[]; forkedFrom?: string } | null> {
    const filePath = join(TRANSCRIPTS_DIR, `${sessionId}.jsonl`);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      const messages: Message[] = [];
      let forkedFrom: string | undefined;

      for (const line of lines) {
        try {
          const record = JSON.parse(line) as TranscriptRecord | { type: string; forkedFrom?: string };

          // Extract fork info from header
          if ("type" in record && record.type === "session_start") {
            forkedFrom = record.forkedFrom;
            continue;
          }

          // Skip header/footer records
          if ("type" in record) {
            continue;
          }

          if ("role" in record) {
            messages.push({
              role: record.role,
              content: record.content,
              toolCalls: record.toolCalls,
              toolResults: record.toolResults,
            });
          }
        } catch {
          // Skip malformed lines
        }
      }

      return { messages, forkedFrom };
    } catch {
      return null;
    }
  }

  /**
   * Delete a transcript.
   */
  static async deleteTranscript(sessionId: string): Promise<boolean> {
    const filePath = join(TRANSCRIPTS_DIR, `${sessionId}.jsonl`);

    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

// Global transcript manager
let globalTranscriptManager: TranscriptManager | null = null;

export function getGlobalTranscriptManager(): TranscriptManager | null {
  return globalTranscriptManager;
}

export function setGlobalTranscriptManager(manager: TranscriptManager | null): void {
  globalTranscriptManager = manager;
}

export async function initTranscriptManager(options?: TranscriptOptions): Promise<TranscriptManager> {
  if (globalTranscriptManager) {
    return globalTranscriptManager;
  }

  const manager = new TranscriptManager(options);
  await manager.init();
  globalTranscriptManager = manager;
  return manager;
}
