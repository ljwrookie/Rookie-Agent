// Declare better-sqlite3 module for dynamic import (optional dependency)
import { Message } from "../agent/types.js";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";

// ─── Types ───────────────────────────────────────────────────────

export interface MemoryEntry {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  createdAt: number;
}

export interface CuratedMemory {
  id: string;
  type: "fact" | "preference" | "decision" | "pattern" | "debug_tip" | "build_command" | "env_issue" | "api_pattern" | "convention";
  content: string;
  confidence: number;
  source: string;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

// ─── MemoryStore ─────────────────────────────────────────────────

/**
 * Persistent memory store using SQLite + FTS5.
 *
 * Falls back gracefully to in-memory storage if better-sqlite3 is not installed.
 * This allows the project to work out of the box while gaining persistence when
 * the dependency is available.
 */
export class MemoryStore {
  private db: any = null;
  private inMemory = new Map<string, Message[]>();
  private curatedInMemory: CuratedMemory[] = [];
  private dbPath: string;
  private initialized = false;

  constructor(dbPath?: string) {
    this.dbPath = dbPath || path.join(os.homedir(), ".rookie", "memory.db");
  }

  // ── Initialization ─────────────────────────────────────────

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      // Dynamic import to avoid hard dependency
      // @ts-ignore — better-sqlite3 is an optional dependency
      const { default: Database } = await import(/* webpackIgnore: true */ "better-sqlite3");

      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrent performance
      this.db.pragma("journal_mode = WAL");

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          tool_calls TEXT,
          tool_call_id TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);

        CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
          content,
          content_rowid='id',
          tokenize='porter unicode61'
        );

        CREATE TABLE IF NOT EXISTS curated_memory (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.5,
          source TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
          use_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS curated_fts USING fts5(
          content,
          content_rowid='rowid',
          tokenize='porter unicode61'
        );
      `);

    } catch {
      // better-sqlite3 not available, use in-memory fallback
      this.db = null;
    }
  }

  // ── Session Messages ───────────────────────────────────────

  async save(sessionId: string, messages: Message[]): Promise<void> {
    await this.ensureInit();

    if (!this.db) {
      this.inMemory.set(sessionId, messages);
      return;
    }

    const insert = this.db.prepare(`
      INSERT INTO sessions (session_id, role, content, tool_calls, tool_call_id)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertFts = this.db.prepare(`
      INSERT INTO sessions_fts (rowid, content) VALUES (?, ?)
    `);

    // Delete existing messages for this session first
    this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);

    const tx = this.db.transaction(() => {
      for (const msg of messages) {
        const result = insert.run(
          sessionId,
          msg.role,
          msg.content,
          msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
          msg.tool_call_id || null
        );
        // Index in FTS
        try {
          insertFts.run(result.lastInsertRowid, msg.content);
        } catch {
          // FTS insert can fail if content is empty
        }
      }
    });

    tx();
  }

  async load(sessionId: string): Promise<Message[]> {
    await this.ensureInit();

    if (!this.db) {
      return this.inMemory.get(sessionId) || [];
    }

    const rows = this.db
      .prepare("SELECT role, content, tool_calls, tool_call_id FROM sessions WHERE session_id = ? ORDER BY id")
      .all(sessionId);

    return rows.map((row: any) => {
      const msg: Message = {
        role: row.role,
        content: row.content,
      };
      if (row.tool_calls) {
        try {
          msg.toolCalls = JSON.parse(row.tool_calls);
        } catch { /* ignore */ }
      }
      if (row.tool_call_id) {
        msg.tool_call_id = row.tool_call_id;
      }
      return msg;
    });
  }

  // ── Full-Text Search ───────────────────────────────────────

  async search(query: string, limit: number): Promise<MemoryEntry[]> {
    await this.ensureInit();

    if (!this.db) {
      // In-memory fallback: simple substring search
      const results: MemoryEntry[] = [];
      for (const [sessionId, messages] of this.inMemory) {
        for (const msg of messages) {
          if (msg.content.includes(query)) {
            results.push({
              id: 0,
              sessionId,
              role: msg.role,
              content: msg.content,
              createdAt: Date.now(),
            });
            if (results.length >= limit) break;
          }
        }
        if (results.length >= limit) break;
      }
      return results;
    }

    const rows = this.db.prepare(`
      SELECT s.id, s.session_id, s.role, s.content, s.created_at
      FROM sessions_fts f
      JOIN sessions s ON s.id = f.rowid
      WHERE sessions_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);

    return rows.map((r: any) => ({
      id: r.id,
      sessionId: r.session_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
    }));
  }

  // ── Curated Memory (Agent-curated, from Hermes) ────────────

  async saveCurated(memory: CuratedMemory): Promise<void> {
    await this.ensureInit();

    if (!this.db) {
      const idx = this.curatedInMemory.findIndex((m) => m.id === memory.id);
      if (idx >= 0) {
        this.curatedInMemory[idx] = memory;
      } else {
        this.curatedInMemory.push(memory);
      }
      return;
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO curated_memory (id, type, content, confidence, source, created_at, last_used_at, use_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      memory.id,
      memory.type,
      memory.content,
      memory.confidence,
      memory.source,
      memory.createdAt,
      memory.lastUsedAt,
      memory.useCount
    );

    // Update FTS
    try {
      this.db.prepare(`
        INSERT INTO curated_fts (rowid, content)
        SELECT rowid, content FROM curated_memory WHERE id = ?
      `).run(memory.id);
    } catch {
      // Ignore FTS errors
    }
  }

  async searchCurated(query: string, limit: number): Promise<CuratedMemory[]> {
    await this.ensureInit();

    if (!this.db) {
      return this.curatedInMemory
        .filter((m) => m.content.includes(query))
        .slice(0, limit);
    }

    const rows = this.db.prepare(`
      SELECT cm.*
      FROM curated_fts f
      JOIN curated_memory cm ON cm.rowid = f.rowid
      WHERE curated_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);

    return rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      content: r.content,
      confidence: r.confidence,
      source: r.source,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      useCount: r.use_count,
    }));
  }

  async getCuratedByType(type: CuratedMemory["type"], limit: number): Promise<CuratedMemory[]> {
    await this.ensureInit();

    if (!this.db) {
      return this.curatedInMemory
        .filter((m) => m.type === type)
        .slice(0, limit);
    }

    return this.db.prepare(`
      SELECT * FROM curated_memory WHERE type = ? ORDER BY last_used_at DESC LIMIT ?
    `).all(type, limit);
  }

  // ── Search with Summary (P4-T4) ────────────────────────────

  /**
   * Search curated memories with optional LLM summary.
   * P4-T4: Enhanced search with summary generation.
   */
  async searchWithSummary(
    query: string,
    options: {
      limit?: number;
      minConfidence?: number;
      types?: CuratedMemory["type"][];
    } = {}
  ): Promise<{
    memories: CuratedMemory[];
    totalConfidence: number;
    averageConfidence: number;
  }> {
    await this.ensureInit();

    const { limit = 10, minConfidence = 0.5, types } = options;

    let memories: CuratedMemory[];

    if (!this.db) {
      memories = this.curatedInMemory
        .filter((m) => {
          if (m.confidence < minConfidence) return false;
          if (types && !types.includes(m.type)) return false;
          return m.content.includes(query);
        })
        .slice(0, limit);
    } else {
      let sql = `
        SELECT cm.*
        FROM curated_fts f
        JOIN curated_memory cm ON cm.rowid = f.rowid
        WHERE curated_fts MATCH ? AND cm.confidence >= ?
      `;
      const params: (string | number)[] = [query, minConfidence];

      if (types && types.length > 0) {
        const placeholders = types.map(() => "?").join(",");
        sql += ` AND cm.type IN (${placeholders})`;
        params.push(...types);
      }

      sql += ` ORDER BY cm.confidence DESC, rank LIMIT ?`;
      params.push(limit);

      const rows = this.db.prepare(sql).all(...params);
      memories = rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        content: r.content,
        confidence: r.confidence,
        source: r.source,
        createdAt: r.created_at,
        lastUsedAt: r.last_used_at,
        useCount: r.use_count,
      }));
    }

    const totalConfidence = memories.reduce((sum, m) => sum + m.confidence, 0);
    const averageConfidence = memories.length > 0 ? totalConfidence / memories.length : 0;

    return {
      memories,
      totalConfidence,
      averageConfidence,
    };
  }

  /**
   * Get recent memories for a session.
   */
  async getRecentForSession(sessionId: string, limit: number = 50): Promise<CuratedMemory[]> {
    await this.ensureInit();

    if (!this.db) {
      return this.curatedInMemory
        .filter((m) => m.source.includes(sessionId))
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    }

    const rows = this.db.prepare(`
      SELECT * FROM curated_memory 
      WHERE source LIKE ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(`%${sessionId}%`, limit);

    return rows.map((r: any) => ({
      id: r.id,
      type: r.type,
      content: r.content,
      confidence: r.confidence,
      source: r.source,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      useCount: r.use_count,
    }));
  }

  // ── Utility ────────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
