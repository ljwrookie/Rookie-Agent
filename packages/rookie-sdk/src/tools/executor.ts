// ─── Streaming Tool Executor ─────────────────────────────────────
// B3: Parallel tool execution with concurrency safety

import { Tool } from "./types.js";
import { ToolRegistry } from "./registry.js";

// B3: Tool execution request
export interface ToolExecutionRequest {
  id: string;
  toolName: string;
  params: Record<string, unknown>;
}

// B3: Tool execution result
export interface ToolExecutionResult {
  id: string;
  toolName: string;
  success: boolean;
  output: string;
  error?: string;
  durationMs: number;
}

// B3: Progress callback for streaming execution
export type ExecutionProgressCallback = (update: {
  requestId: string;
  toolName: string;
  status: "started" | "progress" | "completed" | "error";
  progress?: number;
  message?: string;
}) => void;

// B3: Semaphore for controlling concurrent access
class Semaphore {
  private permits: number;
  private queue: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.permits++;
    const next = this.queue.shift();
    if (next) {
      this.permits--;
      next();
    }
  }
}

// B3: Executor options
export interface StreamingExecutorOptions {
  maxConcurrency?: number;
  onProgress?: ExecutionProgressCallback;
}

// B3: Main executor class
export class StreamingToolExecutor {
  private registry: ToolRegistry;
  private maxConcurrency: number;
  private onProgress?: ExecutionProgressCallback;
  private semaphore: Semaphore;
  // B3: File-level locks for write operations
  private fileLocks = new Map<string, Semaphore>();

  constructor(registry: ToolRegistry, options?: StreamingExecutorOptions) {
    this.registry = registry;
    this.maxConcurrency = options?.maxConcurrency ?? 4;
    this.onProgress = options?.onProgress;
    this.semaphore = new Semaphore(this.maxConcurrency);
  }

  // B3: Execute multiple tools with parallelization
  async executeBatch(requests: ToolExecutionRequest[]): Promise<ToolExecutionResult[]> {
    // Group requests by execution strategy
    const { concurrent, sequential } = this.groupRequests(requests);

    // Execute concurrent group in parallel
    const concurrentPromises = concurrent.map((req) => this.executeSingle(req));

    // Execute sequential group one by one
    const sequentialResults: ToolExecutionResult[] = [];
    for (const req of sequential) {
      const result = await this.executeSingle(req);
      sequentialResults.push(result);
    }

    // Wait for all concurrent executions
    const concurrentResults = await Promise.all(concurrentPromises);

    // Merge results maintaining original order
    return this.mergeResults(requests, concurrentResults, sequentialResults);
  }

  // B3: Execute a single tool with proper locking
  private async executeSingle(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const startTime = Date.now();

    this.onProgress?.({
      requestId: request.id,
      toolName: request.toolName,
      status: "started",
    });

    // Get tool info to determine execution strategy
    const tool = this.getToolInfo(request.toolName);

    try {
      // B3: Acquire appropriate lock
      if (tool?.isConcurrencySafe) {
        // Read-only safe tools use global semaphore
        await this.semaphore.acquire();
      } else {
        // Write tools need file-level lock
        const fileKey = this.getFileKey(request.toolName, request.params);
        const fileLock = this.getFileLock(fileKey);
        await fileLock.acquire();
      }

      const result = await this.registry.invoke(request.toolName, request.params);

      // Release lock
      if (tool?.isConcurrencySafe) {
        this.semaphore.release();
      } else {
        const fileKey = this.getFileKey(request.toolName, request.params);
        this.fileLocks.get(fileKey)?.release();
      }

      const durationMs = Date.now() - startTime;

      this.onProgress?.({
        requestId: request.id,
        toolName: request.toolName,
        status: "completed",
        progress: 1,
      });

      return {
        id: request.id,
        toolName: request.toolName,
        success: true,
        output: result,
        durationMs,
      };
    } catch (e) {
      const durationMs = Date.now() - startTime;
      const error = e instanceof Error ? e.message : String(e);

      // Release lock on error
      if (tool?.isConcurrencySafe) {
        this.semaphore.release();
      } else {
        const fileKey = this.getFileKey(request.toolName, request.params);
        this.fileLocks.get(fileKey)?.release();
      }

      this.onProgress?.({
        requestId: request.id,
        toolName: request.toolName,
        status: "error",
        message: error,
      });

      return {
        id: request.id,
        toolName: request.toolName,
        success: false,
        output: "",
        error,
        durationMs,
      };
    }
  }

  // B3: Group requests for optimal execution
  private groupRequests(requests: ToolExecutionRequest[]): {
    concurrent: ToolExecutionRequest[];
    sequential: ToolExecutionRequest[];
  } {
    const concurrent: ToolExecutionRequest[] = [];
    const sequential: ToolExecutionRequest[] = [];

    for (const req of requests) {
      const tool = this.getToolInfo(req.toolName);
      if (tool?.isConcurrencySafe && tool?.isReadOnly) {
        concurrent.push(req);
      } else {
        sequential.push(req);
      }
    }

    return { concurrent, sequential };
  }

  // B3: Get tool info from registry
  private getToolInfo(toolName: string): Tool | undefined {
    // Access private tools map through list method
    const tools = this.registry.list();
    return tools.find((t) => t.name === toolName);
  }

  // B3: Extract file key from tool params for write locking
  private getFileKey(toolName: string, params: Record<string, unknown>): string {
    const path = params.path || params.file || params.filePath || "";
    return `${toolName}::${path}`;
  }

  // B3: Get or create file lock
  private getFileLock(key: string): Semaphore {
    if (!this.fileLocks.has(key)) {
      this.fileLocks.set(key, new Semaphore(1));
    }
    return this.fileLocks.get(key)!;
  }

  // B3: Merge results maintaining original order
  private mergeResults(
    original: ToolExecutionRequest[],
    concurrent: ToolExecutionResult[],
    sequential: ToolExecutionResult[],
  ): ToolExecutionResult[] {
    const resultMap = new Map<string, ToolExecutionResult>();
    for (const r of concurrent) resultMap.set(r.id, r);
    for (const r of sequential) resultMap.set(r.id, r);

    return original.map((req) => resultMap.get(req.id)!).filter(Boolean);
  }
}
