import { AgentEvent } from "./types.js";

/**
 * SharedBlackboard: a shared, typed data store for inter-agent communication.
 *
 * All agents read/write the same blackboard. Supports:
 * - Key-value entries with metadata (who wrote, when)
 * - Ordered message log for agent-to-agent communication
 * - Event subscriptions for reactive patterns
 */
export class SharedBlackboard {
  private entries = new Map<string, BlackboardEntry>();
  private messageLog: BlackboardMessage[] = [];
  private subscribers = new Map<string, Array<(entry: BlackboardEntry) => void>>();

  /**
   * Write or update a key on the blackboard.
   */
  set(key: string, value: unknown, author: string): void {
    const entry: BlackboardEntry = {
      key,
      value,
      author,
      timestamp: Date.now(),
      version: (this.entries.get(key)?.version || 0) + 1,
    };
    this.entries.set(key, entry);

    // Notify subscribers
    const subs = this.subscribers.get(key);
    if (subs) {
      for (const cb of subs) cb(entry);
    }
    // Wildcard subscribers
    const wildcardSubs = this.subscribers.get("*");
    if (wildcardSubs) {
      for (const cb of wildcardSubs) cb(entry);
    }
  }

  /**
   * Read a key from the blackboard.
   */
  get<T = unknown>(key: string): T | undefined {
    return this.entries.get(key)?.value as T | undefined;
  }

  /**
   * Get the full entry with metadata.
   */
  getEntry(key: string): BlackboardEntry | undefined {
    return this.entries.get(key);
  }

  /**
   * Check if a key exists.
   */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * Delete a key.
   */
  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  /**
   * List all keys, optionally filtered by author.
   */
  keys(author?: string): string[] {
    if (!author) return Array.from(this.entries.keys());
    return Array.from(this.entries.entries())
      .filter(([, e]) => e.author === author)
      .map(([k]) => k);
  }

  /**
   * Get all entries as a snapshot.
   */
  snapshot(): Record<string, BlackboardEntry> {
    const snap: Record<string, BlackboardEntry> = {};
    for (const [k, v] of this.entries) {
      snap[k] = v;
    }
    return snap;
  }

  // ── Message-based communication ─────────────────────

  /**
   * Post a message to the log (agent → agent or broadcast).
   */
  postMessage(from: string, to: string | "*", content: string, metadata?: Record<string, unknown>): void {
    this.messageLog.push({
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      from,
      to,
      content,
      timestamp: Date.now(),
      metadata,
    });
  }

  /**
   * Get messages for a specific agent (or broadcast messages).
   */
  getMessages(agentName: string, since?: number): BlackboardMessage[] {
    return this.messageLog.filter(
      (m) =>
        (m.to === agentName || m.to === "*") &&
        (since === undefined || m.timestamp > since)
    );
  }

  /**
   * Get all messages.
   */
  getAllMessages(): BlackboardMessage[] {
    return [...this.messageLog];
  }

  // ── Subscriptions ─────────────────────────────────────

  /**
   * Subscribe to changes on a specific key (or "*" for all keys).
   */
  subscribe(key: string, callback: (entry: BlackboardEntry) => void): () => void {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, []);
    }
    this.subscribers.get(key)!.push(callback);

    // Return unsubscribe function
    return () => {
      const subs = this.subscribers.get(key);
      if (subs) {
        const idx = subs.indexOf(callback);
        if (idx !== -1) subs.splice(idx, 1);
      }
    };
  }

  // ── Convenience: agent findings ───────────────────────

  /**
   * Record an agent's findings on the blackboard.
   */
  recordFindings(agentName: string, findings: AgentEvent[]): void {
    const existing = this.get<AgentEvent[]>(`findings:${agentName}`) || [];
    this.set(`findings:${agentName}`, [...existing, ...findings], agentName);
  }

  /**
   * Get all findings from a specific agent.
   */
  getFindings(agentName: string): AgentEvent[] {
    return this.get<AgentEvent[]>(`findings:${agentName}`) || [];
  }

  /**
   * Aggregate all agent findings.
   */
  getAllFindings(): Record<string, AgentEvent[]> {
    const result: Record<string, AgentEvent[]> = {};
    for (const key of this.keys()) {
      if (key.startsWith("findings:")) {
        const agent = key.slice(9);
        result[agent] = this.get<AgentEvent[]>(key) || [];
      }
    }
    return result;
  }

  /**
   * Clear the entire blackboard.
   */
  clear(): void {
    this.entries.clear();
    this.messageLog.length = 0;
  }
}

// ── Types ─────────────────────────────────────────────────

export interface BlackboardEntry {
  key: string;
  value: unknown;
  author: string;
  timestamp: number;
  version: number;
}

export interface BlackboardMessage {
  id: string;
  from: string;
  to: string;  // agent name or "*" for broadcast
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}
