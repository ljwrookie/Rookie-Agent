import { Transport, JsonRpcRequest } from "./transport/types.js";

export interface AstApi {
  parse(path: string, content: string): Promise<{ success: boolean; language?: string; root_kind?: string }>;
  search(path: string, pattern: string, content: string): Promise<{ matches: unknown[] }>;
}

export interface IndexApi {
  build(root: string): Promise<{ file_count: number }>;
  search(query: string, limit: number): Promise<{ results: unknown[] }>;
}

export interface SymbolApi {
  resolve(path: string, line: number, column: number): Promise<{ location: unknown | null }>;
  outline(path: string, content: string): Promise<{ outlines: unknown[] }>;
}

export interface KnowledgeApi {
  query(query: string, depth: number): Promise<{ nodes: unknown[] }>;
  analyze(root: string): Promise<{ total_files: number; languages: Record<string, number>; entry_points: string[] }>;
}

import type { LogRecord } from "./logger/index.js";
import { parseLogEvent } from "./logger/index.js";

export class RookieClient {
  private logHandlers: Array<(record: LogRecord) => void> = [];
  private notificationWired = false;

  constructor(private transport: Transport) {}

  /**
   * Subscribe to structured log events emitted by the Rust core via the
   * `log.event` JSON-RPC notification. Returns an unsubscribe function.
   */
  onLog(handler: (record: LogRecord) => void): () => void {
    this.logHandlers.push(handler);
    if (!this.notificationWired) {
      this.notificationWired = true;
      this.transport.onNotification((n) => {
        if (n.method !== "log.event") return;
        const rec = parseLogEvent(n.params);
        if (!rec) return;
        for (const h of this.logHandlers) {
          try { h(rec); } catch { /* swallow */ }
        }
      });
    }
    return () => {
      this.logHandlers = this.logHandlers.filter((h) => h !== handler);
    };
  }

  get ast(): AstApi {
    return {
      parse: async (path: string, content: string) => {
        const response = await this.call("ast.parse", { path, content });
        return response.result as { success: boolean; language?: string; root_kind?: string };
      },
      search: async (path: string, pattern: string, content: string) => {
        const response = await this.call("ast.search", { path, pattern, content });
        return response.result as { matches: unknown[] };
      },
    };
  }

  get index(): IndexApi {
    return {
      build: async (root: string) => {
        const response = await this.call("index.build", { root });
        return response.result as { file_count: number };
      },
      search: async (query: string, limit: number) => {
        const response = await this.call("index.search", { query, limit });
        return response.result as { results: unknown[] };
      },
    };
  }

  get symbol(): SymbolApi {
    return {
      resolve: async (path: string, line: number, column: number) => {
        const response = await this.call("symbol.resolve", { path, line, column });
        return response.result as { location: unknown | null };
      },
      outline: async (path: string, content: string) => {
        const response = await this.call("symbol.outline", { path, content });
        return response.result as { outlines: unknown[] };
      },
    };
  }

  get knowledge(): KnowledgeApi {
    return {
      query: async (query: string, depth: number) => {
        const response = await this.call("knowledge.query", { query, depth });
        return response.result as { nodes: unknown[] };
      },
      analyze: async (root: string) => {
        const response = await this.call("knowledge.analyze", { root });
        return response.result as { total_files: number; languages: Record<string, number>; entry_points: string[] };
      },
    };
  }

  private async call(method: string, params: Record<string, unknown>): Promise<{ result?: unknown; error?: unknown }> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: Math.random().toString(36).slice(2),
      method,
      params,
    };

    const response = await this.transport.send(request);

    if (response.error) {
      throw new Error(`JSON-RPC error: ${response.error.message}`);
    }

    return { result: response.result };
  }
}
