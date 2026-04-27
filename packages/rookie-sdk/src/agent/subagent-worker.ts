/**
 * SubagentWorker: MCP JSON-RPC over stdio worker for cross-process subagents.
 *
 * This module runs inside a child process and communicates with the parent
 * via JSON-RPC over stdin/stdout (MCP protocol).
 *
 * D1: Cross-process Subagent with MCP Stdio reuse
 */

import type { AgentEvent, SubagentMode, AgentMetrics } from "./types.js";
import type { SubagentConfig, SubagentResult } from "./subagent.js";

// MCP JSON-RPC types
interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

// Worker state
interface WorkerState {
  agentName: string;
  config: SubagentConfig;
  metrics: AgentMetrics;
  events: AgentEvent[];
  startTime: number;
  isRunning: boolean;
}

/**
 * SubagentWorker: handles MCP JSON-RPC communication over stdio.
 */
export class SubagentWorker {
  private state: WorkerState | null = null;
  private buffer = "";

  /**
   * Run the worker - starts listening on stdin.
   */
  async run(): Promise<void> {
    // Check recursion depth
    const depth = this.getRecursionDepth();
    if (depth >= 3) {
      this.sendErrorResponse(0, -32000, `Recursion depth exceeded: ${depth}/3`);
      process.exit(78); // EXIT_CODE_PERMANENT
    }

    // Set up stdin/stdout handlers
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (data: string) => {
      this.buffer += data;
      this.processBuffer();
    });

    process.stdin.on("end", () => {
      this.shutdown();
    });

    // Send ready notification
    this.sendNotification("subagent/ready", {
      pid: process.pid,
      recursionDepth: depth,
      querySource: "subagent",
    });

    // Keep process alive
    await new Promise(() => {
      // Process stays alive until stdin closes or shutdown is called
    });
  }

  /**
   * Process incoming JSON-RPC messages from stdin.
   */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as McpRequest | McpNotification;

        if ("id" in message && message.id !== undefined) {
          // This is a request
          this.handleRequest(message as McpRequest);
        } else {
          // This is a notification
          this.handleNotification(message as McpNotification);
        }
      } catch (e) {
        this.sendErrorResponse(0, -32700, `Parse error: ${e}`);
      }
    }
  }

  /**
   * Handle JSON-RPC request.
   */
  private async handleRequest(request: McpRequest): Promise<void> {
    try {
      switch (request.method) {
        case "subagent/init": {
          const result = await this.handleInit(request.params as { config: SubagentConfig; task: string });
          this.sendResponse(request.id, result);
          break;
        }

        case "subagent/run": {
          const result = await this.handleRun();
          this.sendResponse(request.id, result);
          break;
        }

        case "subagent/cancel": {
          this.handleCancel();
          this.sendResponse(request.id, { success: true });
          break;
        }

        case "subagent/getMetrics": {
          this.sendResponse(request.id, { metrics: this.state?.metrics || null });
          break;
        }

        default:
          this.sendErrorResponse(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (e) {
      this.sendErrorResponse(
        request.id,
        -32603,
        `Internal error: ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  /**
   * Handle JSON-RPC notification.
   */
  private handleNotification(notification: McpNotification): void {
    switch (notification.method) {
      case "subagent/shutdown":
        this.shutdown();
        break;

      case "subagent/heartbeat":
        // Acknowledge heartbeat
        this.sendNotification("subagent/heartbeatAck", { timestamp: Date.now() });
        break;

      default:
        // Unknown notifications are ignored
        break;
    }
  }

  /**
   * Initialize the worker with config and task.
   */
  private async handleInit(params: { config: SubagentConfig; task: string }): Promise<{ success: boolean }> {
    const { config, task } = params;

    this.state = {
      agentName: config.name,
      config,
      metrics: {
        agentId: config.name,
        startTime: Date.now(),
        toolCalls: 0,
        tokensUsed: 0,
        messagesExchanged: 0,
        errors: 0,
        duration: 0,
      },
      events: [],
      startTime: Date.now(),
      isRunning: false,
    };

    // Store task in environment for reference
    process.env.ROOKIE_SUBAGENT_TASK = task;
    process.env.ROOKIE_SUBAGENT_NAME = config.name;
    process.env.ROOKIE_SUBAGENT_DEPTH = String(this.getRecursionDepth());

    return { success: true };
  }

  /**
   * Run the subagent task.
   */
  private async handleRun(): Promise<SubagentResult> {
    if (!this.state) {
      throw new Error("Worker not initialized");
    }

    const { config, metrics, events } = this.state;
    const task = process.env.ROOKIE_SUBAGENT_TASK || "";

    this.state.isRunning = true;

    try {
      // Send event notification for each event
      const eventProxy: AgentEvent[] = [];

      // Simulate agent execution (actual implementation would use real agent)
      // For now, we emit thinking events
      this.emitEvent({ type: "thinking", content: `Starting task: ${task}` });

      // Simulate some work
      await this.simulateWork(config, task, eventProxy, metrics);

      const duration = Date.now() - this.state.startTime;
      metrics.duration = duration;

      const result: SubagentResult = {
        name: config.name,
        success: true,
        events: eventProxy,
        duration,
        mode: "child" as SubagentMode,
        metrics: { ...metrics },
      };

      this.state.isRunning = false;
      return result;
    } catch (e) {
      metrics.errors++;
      this.state.isRunning = false;

      return {
        name: config.name,
        success: false,
        events,
        duration: Date.now() - this.state.startTime,
        mode: "child" as SubagentMode,
        metrics: { ...metrics },
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Simulate agent work (placeholder for actual agent execution).
   */
  private async simulateWork(
    config: SubagentConfig,
    task: string,
    events: AgentEvent[],
    metrics: AgentMetrics
  ): Promise<void> {
    // This is a placeholder - in real implementation, this would:
    // 1. Load the agent module
    // 2. Set up the context with restricted tools
    // 3. Run the agent's run() method
    // 4. Stream events back to parent

    this.emitEvent({ type: "thinking", content: `Processing: ${task}` });
    events.push({ type: "thinking", content: `Processing: ${task}` });

    // Simulate tool call
    if (config.allowedTools && config.allowedTools.length > 0) {
      this.emitEvent({
        type: "tool_call",
        call: { id: `call-${Date.now()}`, name: config.allowedTools[0], params: {} },
      });
      events.push({
        type: "tool_call",
        call: { id: `call-${Date.now()}`, name: config.allowedTools[0], params: {} },
      });
      metrics.toolCalls++;

      await new Promise((resolve) => setTimeout(resolve, 100));

      this.emitEvent({
        type: "tool_result",
        result: { id: `call-${Date.now()}`, name: config.allowedTools[0], output: "Result" },
        duration: 100,
      });
      events.push({
        type: "tool_result",
        result: { id: `call-${Date.now()}`, name: config.allowedTools[0], output: "Result" },
        duration: 100,
      });
    }

    // Simulate response
    const response = `Task completed: ${task}`;
    this.emitEvent({ type: "response", content: response, done: true });
    events.push({ type: "response", content: response, done: true });
    metrics.messagesExchanged++;
    metrics.tokensUsed += Math.ceil(response.length / 4);

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  /**
   * Handle cancel request.
   */
  private handleCancel(): void {
    if (this.state) {
      this.state.isRunning = false;
      this.emitEvent({ type: "error", error: "Task cancelled by parent" });
    }
  }

  /**
   * Send JSON-RPC response.
   */
  private sendResponse(id: string | number, result: unknown): void {
    const response: McpResponse = {
      jsonrpc: "2.0",
      id,
      result,
    };
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  /**
   * Send JSON-RPC error response.
   */
  private sendErrorResponse(id: string | number, code: number, message: string): void {
    const response: McpResponse = {
      jsonrpc: "2.0",
      id,
      error: { code, message },
    };
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  /**
   * Send JSON-RPC notification.
   */
  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const notification: McpNotification = {
      jsonrpc: "2.0",
      method,
      params,
    };
    process.stdout.write(JSON.stringify(notification) + "\n");
  }

  /**
   * Emit event to parent via notification.
   */
  private emitEvent(event: AgentEvent): void {
    this.sendNotification("subagent/event", { event });
  }

  /**
   * Get current recursion depth from environment.
   */
  private getRecursionDepth(): number {
    const depth = parseInt(process.env.ROOKIE_SUBAGENT_DEPTH || "0", 10);
    return isNaN(depth) ? 0 : depth;
  }

  /**
   * Shutdown the worker.
   */
  private shutdown(): void {
    this.sendNotification("subagent/exiting", {
      timestamp: Date.now(),
      metrics: this.state?.metrics || null,
    });
    process.exit(0);
  }
}

// If this file is run directly (as a child process)
if (import.meta.url === `file://${process.argv[1]}`) {
  const worker = new SubagentWorker();
  worker.run().catch((e) => {
    console.error(`Worker error: ${e}`);
    process.exit(1);
  });
}
