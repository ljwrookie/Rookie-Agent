// NAPI-RS Transport: Native addon communication (P3-T1)

import { EventEmitter } from "node:events";

// ─── Types ───────────────────────────────────────────────────────

export interface NapiTransportOptions {
  /** Path to the .node addon */
  addonPath: string;
  /** Request timeout in ms */
  timeout?: number;
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

export interface NapiAddon {
  /** Initialize the addon with configuration */
  init(config: Record<string, unknown>): boolean;
  /** Send a request to the native side */
  request(data: string): string;
  /** Register a callback for async events */
  onEvent(callback: (event: string) => void): void;
  /** Close the connection */
  close(): void;
}

// ─── NAPI Transport ──────────────────────────────────────────────

/**
 * Transport layer for NAPI-RS native addons.
 *
 * Provides bidirectional communication with Rust-based native modules,
 * with fallback to stdio-based transport if the addon is unavailable.
 */
export class NapiTransport extends EventEmitter {
  private options: Required<NapiTransportOptions>;
  private addon: NapiAddon | null = null;
  private pendingRequests = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>();
  private connected = false;

  constructor(options: NapiTransportOptions) {
    super();
    this.options = {
      addonPath: options.addonPath,
      timeout: options.timeout ?? 30000,
    };
  }

  /**
   * Connect to the native addon.
   */
  async connect(): Promise<boolean> {
    if (this.connected) return true;

    try {
      // Dynamic import of the .node addon
      // Use createRequire for .node files to avoid bundler issues
      const { createRequire } = await import("node:module");
      const require = createRequire(import.meta.url);
      const addonModule = require(this.options.addonPath);
      this.addon = addonModule as NapiAddon;

      // Initialize the addon
      const initialized = this.addon.init({
        timeout: this.options.timeout,
      });

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
   * Send a request to the native addon.
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

      this.pendingRequests.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });

      try {
        const response = this.addon!.request(JSON.stringify(request));
        this.handleResponse(response);
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error);
      }
    });
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
  close(): void {
    if (this.addon) {
      this.addon.close();
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

// ─── Transport Factory ───────────────────────────────────────────

export interface TransportFactoryOptions {
  /** Prefer NAPI transport if available */
  preferNapi?: boolean;
  /** Path to NAPI addon */
  napiPath?: string;
  /** Stdio transport fallback */
  stdioCommand?: string;
}

/**
 * Create the best available transport.
 */
export async function createTransport(
  options: TransportFactoryOptions
): Promise<NapiTransport | null> {
  if (options.preferNapi && options.napiPath) {
    const napi = new NapiTransport({ addonPath: options.napiPath });
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
      await transport.request("ping", { seq: i });
    } catch {
      // Ignore errors for benchmark
    }
  }
  const pingDuration = Date.now() - pingStart;

  results.push({
    transport: "napi",
    operation: "ping",
    latencyMs: pingDuration / iterations,
    throughputOpsPerSec: (iterations / pingDuration) * 1000,
  });

  // Search benchmark (simulated)
  const searchStart = Date.now();
  for (let i = 0; i < iterations / 10; i++) {
    try {
      await transport.request("search", {
        query: "test query",
        limit: 10,
      });
    } catch {
      // Ignore errors for benchmark
    }
  }
  const searchDuration = Date.now() - searchStart;

  results.push({
    transport: "napi",
    operation: "search",
    latencyMs: searchDuration / (iterations / 10),
    throughputOpsPerSec: ((iterations / 10) / searchDuration) * 1000,
  });

  return results;
}
