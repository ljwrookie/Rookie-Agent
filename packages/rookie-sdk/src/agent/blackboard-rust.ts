/**
 * Rust-backed Blackboard client
 *
 * Delegates to Rust NAPI implementation for high-performance
 * concurrent operations with CAS support.
 */

import type { BlackboardEntry } from "./blackboard.js";

// NAPI bindings will be loaded dynamically. The native addon is built out-of-
// tree (and may be absent in pure-JS environments), so we keep the type loose
// and resolve it at runtime.
type NativeModule = {
  BlackboardWrapper?: new () => unknown;
  [key: string]: unknown;
};

let native: NativeModule | null = null;

async function loadNative(): Promise<NativeModule | null> {
  if (!native) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const specifier = "../../../native/index.js" as any;
      native = (await import(specifier)) as NativeModule;
    } catch {
      // Native module not available, fall back to JS implementation
      native = null;
    }
  }
  return native;
}

/**
 * Rust-backed SharedBlackboard
 *
 * Uses DashMap in Rust for high-performance concurrent access.
 * Falls back to JS implementation if native module unavailable.
 */
export class RustBlackboard {
  private nativeBoard: any = null;
  private fallbackBoard: any = null;
  private useNative = false;

  constructor() {
    this.init();
  }

  private async init() {
    const napi = await loadNative();
    if (napi?.BlackboardWrapper) {
      this.nativeBoard = new napi.BlackboardWrapper();
      this.useNative = true;
    } else {
      // Fallback: import JS implementation
      const { SharedBlackboard } = await import("./blackboard.js");
      this.fallbackBoard = new SharedBlackboard();
      this.useNative = false;
    }
  }

  /**
   * Write or update a key on the blackboard.
   */
  async set(key: string, value: unknown, author: string): Promise<void> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      this.nativeBoard.set("default", key, JSON.stringify(value), author);
    } else {
      this.fallbackBoard.set(key, value, author);
    }
  }

  /**
   * Read a key from the blackboard.
   */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      const value = this.nativeBoard.get("default", key);
      return value ? JSON.parse(value) : undefined;
    } else {
      return this.fallbackBoard.get(key);
    }
  }

  /**
   * Get the full entry with metadata.
   */
  async getEntry(key: string): Promise<BlackboardEntry | undefined> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      const entry = this.nativeBoard.getEntry("default", key);
      if (!entry) return undefined;
      return {
        key: entry.key,
        value: JSON.parse(entry.value),
        author: entry.author,
        timestamp: entry.timestamp,
        version: entry.version,
      };
    } else {
      return this.fallbackBoard.getEntry(key);
    }
  }

  /**
   * Compare-And-Swap operation
   *
   * Only updates if the current version matches expected_version.
   * Returns true if successful, false if version mismatch.
   */
  async cas(key: string, expectedVersion: number, value: unknown, author: string): Promise<boolean> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      return this.nativeBoard.cas("default", key, expectedVersion, JSON.stringify(value), author);
    } else {
      // Fallback: manual version check
      const entry = this.fallbackBoard.getEntry(key);
      if (!entry || entry.version !== expectedVersion) {
        return false;
      }
      this.fallbackBoard.set(key, value, author);
      return true;
    }
  }

  /**
   * Set with TTL (time-to-live in milliseconds)
   */
  async setWithTTL(key: string, value: unknown, author: string, ttlMs: number): Promise<void> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      this.nativeBoard.setWithTtl("default", key, JSON.stringify(value), author, ttlMs);
    } else {
      // Fallback: set without TTL
      this.fallbackBoard.set(key, value, author);
    }
  }

  /**
   * Check if a key exists.
   */
  async has(key: string): Promise<boolean> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      return this.nativeBoard.has("default", key);
    } else {
      return this.fallbackBoard.has(key);
    }
  }

  /**
   * Delete a key.
   */
  async delete(key: string, author: string): Promise<boolean> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      return this.nativeBoard.delete("default", key, author);
    } else {
      return this.fallbackBoard.delete(key);
    }
  }

  /**
   * List all keys, optionally filtered by prefix.
   */
  async keys(prefix?: string): Promise<string[]> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      return this.nativeBoard.keys("default", prefix || null);
    } else {
      return this.fallbackBoard.keys();
    }
  }

  /**
   * Get all entries as a snapshot.
   */
  async snapshot(): Promise<Record<string, BlackboardEntry>> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      const snapshotJson = this.nativeBoard.snapshot("default");
      const values = JSON.parse(snapshotJson);
      const result: Record<string, BlackboardEntry> = {};
      for (const key of Object.keys(values)) {
        const entry = this.nativeBoard.getEntry("default", key);
        if (entry) {
          result[key] = {
            key,
            value: JSON.parse(entry.value),
            author: entry.author,
            timestamp: entry.timestamp,
            version: entry.version,
          };
        }
      }
      return result;
    } else {
      return this.fallbackBoard.snapshot();
    }
  }

  /**
   * Get entry count.
   */
  async count(): Promise<number> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      return this.nativeBoard.count("default");
    } else {
      return this.fallbackBoard.keys().length;
    }
  }

  /**
   * Clear the entire blackboard.
   */
  async clear(author: string): Promise<number> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      return this.nativeBoard.clearNamespace("default", author);
    } else {
      this.fallbackBoard.clear();
      return 0;
    }
  }

  /**
   * Subscribe to changes on a specific key.
   * Note: Native watch not yet implemented, falls back to polling.
   */
  subscribe(key: string, callback: (entry: BlackboardEntry) => void): () => void {
    if (this.useNative && this.nativeBoard) {
      // TODO: Implement native watch when available
      // For now, use polling fallback
      let lastVersion = 0;
      const interval = setInterval(async () => {
        const entry = await this.getEntry(key);
        if (entry && entry.version !== lastVersion) {
          lastVersion = entry.version;
          callback(entry);
        }
      }, 100);
      return () => clearInterval(interval);
    } else {
      return this.fallbackBoard.subscribe(key, callback);
    }
  }

  // ── Namespace operations ─────────────────────────────────

  /**
   * Set in a specific namespace.
   */
  async setInNamespace(namespace: string, key: string, value: unknown, author: string): Promise<void> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      this.nativeBoard.set(namespace, key, JSON.stringify(value), author);
    }
  }

  /**
   * Get from a specific namespace.
   */
  async getFromNamespace<T = unknown>(namespace: string, key: string): Promise<T | undefined> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      const value = this.nativeBoard.get(namespace, key);
      return value ? JSON.parse(value) : undefined;
    }
    return undefined;
  }

  /**
   * List all namespaces.
   */
  async listNamespaces(): Promise<string[]> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      return this.nativeBoard.listNamespaces();
    }
    return ["default"];
  }

  /**
   * Remove an entire namespace.
   */
  async removeNamespace(namespace: string): Promise<boolean> {
    await this.init();
    if (this.useNative && this.nativeBoard) {
      return this.nativeBoard.removeNamespace(namespace);
    }
    return false;
  }
}

// Singleton instance
let globalBlackboard: RustBlackboard | null = null;

export function getGlobalBlackboard(): RustBlackboard {
  if (!globalBlackboard) {
    globalBlackboard = new RustBlackboard();
  }
  return globalBlackboard;
}

export function setGlobalBlackboard(board: RustBlackboard | null): void {
  globalBlackboard = board;
}
