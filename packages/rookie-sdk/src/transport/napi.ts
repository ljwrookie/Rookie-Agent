// NAPI-RS Transport: Native addon communication (P4-T1)
// Upgraded to use napi-rs v3 with full TypeScript support

import { EventEmitter } from "node:events";
import type {
  NativeModule,
  RookieNapiAddon,
  TokenCountRequest,
  TokenCountResponse,
  TruncateRequest,
  TruncateResponse,
  PipelineMessage,
  PipelineConfig,
  PipelineResponse,
} from "./napi-types.js";
import { loadNativeAddon } from "./napi-types.js";
import type { Message } from "../agent/types.js";

export type NapiAddon = RookieNapiAddon;

export interface NativePatchFailure {
  hunk_index: number;
  old_start: number;
  reason: string;
}

export interface NativePatchResult {
  success: boolean;
  content: string;
  failed_hunks: NativePatchFailure[];
}

export interface NativeGlobMatchParams {
  path: string;
  pattern: string;
  limit: number;
  offset: number;
  hidden: boolean;
}

export interface NativeGlobMatchResult {
  path: string;
}

export interface NativeGrepSearchParams {
  path: string;
  pattern: string;
  glob?: string;
  output: string;
  limit: number;
  offset: number;
  case_insensitive: boolean;
  literal: boolean;
}

export interface NativeGrepSearchResult {
  matches: Array<{ path: string; line: number; content: string }>;
  files_searched: number;
  duration_ms: number;
}

export const applyPatch:
  | ((source: string, diff: string, options?: { fuzzy?: boolean }) => NativePatchResult)
  | undefined = undefined;

export const computeDiff:
  | ((original: string, updated: string) => string)
  | undefined = undefined;

export const globMatch:
  | ((params: NativeGlobMatchParams) => NativeGlobMatchResult[])
  | undefined = undefined;

export const grepSearch:
  | ((params: NativeGrepSearchParams) => NativeGrepSearchResult)
  | undefined = undefined;

// ─── Types ───────────────────────────────────────────────────────

export interface NapiTransportOptions {
  /** Path to the .node addon (optional, will auto-detect if not provided) */
  addonPath?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Model for token counting (cl100k_base | o200k_base) */
  model?: string;
}

export interface NapiRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface NapiResponse {
  id: string;
  result?: unknown;
  error?: string;
}

// ─── NAPI Transport ──────────────────────────────────────────────

/**
 * Transport layer for NAPI-RS native addons.
 *
 * Provides bidirectional communication with Rust-based native modules,
 * with fallback to JS implementation if the addon is unavailable.
 * 
 * P4-T1: Uses napi-rs v3 with derive macros for type-safe bindings.
 */
export class NapiTransport extends EventEmitter {
  private options: Required<NapiTransportOptions>;
  private addon: RookieNapiAddon | null = null;
  private nativeModule: NativeModule | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private connected = false;

  constructor(options: NapiTransportOptions = {}) {
    super();
    this.options = {
      addonPath: options.addonPath ?? "",
      timeout: options.timeout ?? 30000,
      model: options.model ?? "cl100k_base",
    };
  }

  /**
   * Connect to the native addon.
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;

    try {
      // Load native module
      this.nativeModule = loadNativeAddon();
      this.addon = new this.nativeModule.RookieNapi();

      // Initialize the addon
      const config = JSON.stringify({
        timeout: this.options.timeout,
        model: this.options.model,
      });
      
      const initialized = await this.addon.init(config);

      if (!initialized) {
        throw new Error("Addon initialization failed");
      }

      // Set up event listener
      this.addon.onEvent((eventData) => {
        this.handleEvent(eventData);
      });

      this.connected = true;
      this.emit("connect");
      return true;
    } catch (error) {
      this.emit("error", error);
      return false;
    }
  }

  /**
   * Check if transport is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Close the transport connection.
   */
  async close(): Promise<void> {
    if (this.addon) {
      await this.addon.close();
    }

    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Transport closed"));
    }
    this.pendingRequests.clear();

    this.connected = false;
    this.emit("close");
  }

  // ─── Tokenizer Methods (P4-T2) ──────────────────────────────────

  /**
   * Count tokens in text using tiktoken-rs.
   * P4-T2: Accurate token counting with < 1% error.
   */
  async countTokens(text: string, model?: string): Promise<number> {
    if (!this.connected || !this.addon) {
      throw new Error("Transport not connected");
    }

    const request: TokenCountRequest = {
      text,
      model: model ?? this.options.model,
    };

    const response: TokenCountResponse = await this.addon.countTokens(request);
    return response.count;
  }

  /**
   * Truncate text to maximum tokens.
   * P4-T2: Intelligent truncation using tiktoken-rs.
   */
  async truncateToTokens(
    text: string,
    maxTokens: number,
    model?: string
  ): Promise<TruncateResponse> {
    if (!this.connected || !this.addon) {
      throw new Error("Transport not connected");
    }

    const request: TruncateRequest = {
      text,
      maxTokens,
      model: model ?? this.options.model,
    };

    return await this.addon.truncateToTokens(request);
  }

  // ─── Context Pipeline Methods (P4-T3) ───────────────────────────

  /**
   * Run the 5-stage context pipeline.
   * P4-T3: Rust-powered context preprocessing.
   */
  async runContextPipeline(
    messages: Message[],
    config?: PipelineConfig
  ): Promise<{ messages: Message[]; stats: PipelineStats }> {
    if (!this.connected || !this.addon) {
      // Fallback to JS implementation
      return this.runContextPipelineJS(messages, config);
    }

    // Convert messages to pipeline format
    const pipelineMessages: PipelineMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
      toolCalls: m.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.name,
        params: JSON.stringify(tc.params),
      })),
      toolCallId: m.tool_call_id,
      metadata: m.metadata ? JSON.stringify(m.metadata) : undefined,
    }));

    const response: PipelineResponse = await this.addon.runContextPipeline(
      pipelineMessages,
      config
    );

    // Convert back to Message format
    const resultMessages: Message[] = response.messages.map((m) => ({
      role: m.role as Message["role"],
      content: m.content,
      toolCalls: m.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.name,
        params: JSON.parse(tc.params),
      })),
      tool_call_id: m.toolCallId,
      metadata: m.metadata ? JSON.parse(m.metadata) : undefined,
    }));

    return {
      messages: resultMessages,
      stats: {
        stage1ToolResults: response.stats.stage1ToolResults,
        stage2Snipped: response.stats.stage2Snipped,
        stage3Normalized: response.stats.stage3Normalized,
        stage4Collapsed: response.stats.stage4Collapsed,
        stage5Compacted: response.stats.stage5Compacted,
        totalTokensBefore: response.stats.totalTokensBefore,
        totalTokensAfter: response.stats.totalTokensAfter,
      },
    };
  }

  /**
   * Fallback JS implementation of context pipeline.
   */
  private runContextPipelineJS(
    messages: Message[],
    config?: PipelineConfig
  ): { messages: Message[]; stats: PipelineStats } {
    // Import the JS implementation
    const { runContextPipeline } = require("../agent/context-pipeline.js");
    const result = runContextPipeline(messages, {
      maxToolResultTokens: config?.maxToolResultTokens,
      snipThreshold: config?.snipThreshold,
      maxMessages: config?.maxMessages,
      compactThreshold: config?.compactThreshold,
    });

    return {
      messages: result.messages,
      stats: {
        stage1ToolResults: result.stats.stage1ToolResults,
        stage2Snipped: result.stats.stage2Snipped,
        stage3Normalized: result.stats.stage3Normalized,
        stage4Collapsed: result.stats.stage4Collapsed,
        stage5Compacted: result.stats.stage5Compacted,
        totalTokensBefore: result.stats.totalTokensBefore,
        totalTokensAfter: result.stats.totalTokensAfter,
      },
    };
  }

  // ─── Legacy Methods (Backward Compatibility) ────────────────────

  /**
   * Send a generic request to the native addon.
   * @deprecated Use specific methods like countTokens() instead
   */
  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.connected || !this.addon) {
      throw new Error("Transport not connected");
    }

    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const request: NapiRequest = { id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.options.timeout);

      this.pendingRequests.set(id, { 
        resolve: resolve as (value: unknown) => void, 
        reject, 
        timer 
      });

      this.addon!.request(JSON.stringify(request))
        .then((response) => this.handleResponse(response))
        .catch((error) => {
          clearTimeout(timer);
          this.pendingRequests.delete(id);
          reject(error);
        });
    });
  }

  // ─── Private helpers ────────────────────────────────────────

  private handleResponse(data: string): void {
    try {
      const response: NapiResponse = JSON.parse(data);
      const pending = this.pendingRequests.get(response.id);

      if (!pending) return;

      clearTimeout(pending.timer);
      this.pendingRequests.delete(response.id);

      if (response.error) {
        pending.reject(new Error(response.error));
      } else {
        pending.resolve(response.result);
      }
    } catch (error) {
      this.emit("error", error);
    }
  }

  private handleEvent(data: string): void {
    try {
      const event = JSON.parse(data);
      this.emit("event", event);

      // Emit specific event types
      if (event.type) {
        this.emit(event.type, event.data);
      }
    } catch (error) {
      this.emit("error", error);
    }
  }
}

// ─── Pipeline Stats Interface ────────────────────────────────────

export interface PipelineStats {
  stage1ToolResults: number;
  stage2Snipped: number;
  stage3Normalized: number;
  stage4Collapsed: number;
  stage5Compacted: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
}

// ─── Transport Factory ───────────────────────────────────────────

export interface TransportFactoryOptions {
  /** Prefer NAPI transport if available */
  preferNapi?: boolean;
  /** Path to NAPI addon */
  napiPath?: string;
  /** Model for token counting */
  model?: string;
  /** Stdio transport fallback */
  stdioCommand?: string;
}

/**
 * Create the best available transport.
 */
export async function createTransport(
  options: TransportFactoryOptions = {}
): Promise<NapiTransport | null> {
  if (options.preferNapi !== false) {
    const napi = new NapiTransport({
      addonPath: options.napiPath,
      model: options.model,
    });
    const connected = await napi.connect();
    if (connected) return napi;
  }

  // Fallback to stdio would go here
  return null;
}

// ─── Benchmark Utilities ─────────────────────────────────────────

export interface TransportBenchmark {
  transport: string;
  operation: string;
  latencyMs: number;
  throughputOpsPerSec: number;
}

/**
 * Benchmark transport performance.
 */
export async function benchmarkTransport(
  transport: NapiTransport,
  iterations: number = 1000
): Promise<TransportBenchmark[]> {
  const results: TransportBenchmark[] = [];

  // Ping benchmark
  const pingStart = Date.now();
  for (let i = 0; i < iterations; i++) {
    try {
      await transport.countTokens("ping test");
    } catch {
      // Ignore errors for benchmark
    }
  }
  const pingDuration = Date.now() - pingStart;

  results.push({
    transport: "napi",
    operation: "countTokens",
    latencyMs: pingDuration / iterations,
    throughputOpsPerSec: (iterations / pingDuration) * 1000,
  });

  // Pipeline benchmark
  const pipelineStart = Date.now();
  const testMessages: Message[] = [
    { role: "system", content: "You are helpful" },
    { role: "user", content: "Hello world" },
  ];
  
  for (let i = 0; i < iterations / 10; i++) {
    try {
      await transport.runContextPipeline(testMessages);
    } catch {
      // Ignore errors for benchmark
    }
  }
  const pipelineDuration = Date.now() - pipelineStart;

  results.push({
    transport: "napi",
    operation: "runContextPipeline",
    latencyMs: pipelineDuration / (iterations / 10),
    throughputOpsPerSec: ((iterations / 10) / pipelineDuration) * 1000,
  });

  return results;
}
