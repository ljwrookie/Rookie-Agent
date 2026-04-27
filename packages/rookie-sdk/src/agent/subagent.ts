import { spawn, ChildProcess } from "child_process";
import { Agent, AgentInput, AgentContext, AgentEvent, Message } from "./types.js";
import {
  SubagentMode,
  AgentMessage,
  WorktreeConfig,
  ResourceLimits,
  AgentMetrics,
} from "./types.js";
import { SharedBlackboard } from "./blackboard.js";
import { ToolRegistry } from "../tools/registry.js";

/**
 * SubagentConfig: defines how a subagent is spawned and executed.
 * Enhanced for Phase-D multi-agent collaboration.
 */
export interface SubagentConfig {
  name: string;
  agent: Agent;
  systemPrompt?: string;       // Override agent's default system prompt
  preloadSkills?: string[];    // Skills to preload in context
  allowedTools?: string[];     // Restrict tools (default: all)
  model?: string;              // Override model selection
  /** D1: contextMode now supports "process" for cross-process subagents */
  contextMode: "fork" | "shared" | "process";  // fork = isolated context, shared = same blackboard, process = child process
  timeout?: number;            // Max execution time in ms

  // === Phase-D Enhancements ===
  /** Execution mode - three paths like CCB */
  mode?: SubagentMode;
  /** Remote endpoint for remote mode */
  remoteEndpoint?: string;
  /** Worktree configuration for git isolation */
  worktree?: WorktreeConfig;
  /** Resource limits for child process mode */
  resourceLimits?: ResourceLimits;
  /** Task priority */
  priority?: "critical" | "high" | "normal" | "low";
  /** Maximum retries on failure */
  maxRetries?: number;
}

export interface SubagentTask {
  config: SubagentConfig;
  task: string;
  context?: Record<string, unknown>;  // Additional context for the subagent
}

export interface SubagentResult {
  name: string;
  success: boolean;
  events: AgentEvent[];
  duration: number;
  error?: string;
  // === Phase-D Enhancements ===
  /** Execution mode used */
  mode?: SubagentMode;
  /** Metrics collected during execution */
  metrics?: AgentMetrics;
  /** Worktree path if worktree mode was used */
  worktreePath?: string;
  /** Retry count if retries were attempted */
  retryCount?: number;
}

/**
 * SubagentManager: Claude Code-style subagent delegation.
 *
 * Supports:
 * - Single delegation with context fork or shared blackboard
 * - Parallel delegation (fan-out to multiple subagents)
 * - Tool restriction per subagent
 * - Timeout enforcement
 * - Three execution modes: in-process / child / remote (Phase-D)
 * - Worktree isolation for git-based projects (Phase-D)
 * - Resource limits and monitoring (Phase-D)
 */
export class SubagentManager {
  private blackboard: SharedBlackboard;
  private activeSubagents = new Map<string, AbortController>();
  private childProcesses = new Map<string, ChildProcess>();
  private messageHandlers = new Map<string, ((msg: AgentMessage) => void)[]>();
  private metrics = new Map<string, AgentMetrics>();

  constructor(blackboard?: SharedBlackboard) {
    this.blackboard = blackboard || new SharedBlackboard();
  }

  getBlackboard(): SharedBlackboard {
    return this.blackboard;
  }

  /**
   * Get metrics for a completed or running subagent.
   */
  getMetrics(agentName: string): AgentMetrics | undefined {
    return this.metrics.get(agentName);
  }

  /**
   * Send a message to a subagent.
   */
  async sendMessage(message: AgentMessage): Promise<void> {
    // Store message on blackboard for shared mode
    this.blackboard.postMessage(message.from, message.to, JSON.stringify(message));

    // Notify handlers
    const handlers = this.messageHandlers.get(message.to) || [];
    for (const handler of handlers) {
      try {
        handler(message);
      } catch (e) {
        console.error(`Message handler error: ${e}`);
      }
    }
  }

  /**
   * Register a message handler for an agent.
   */
  onMessage(agentName: string, handler: (msg: AgentMessage) => void): void {
    const handlers = this.messageHandlers.get(agentName) || [];
    handlers.push(handler);
    this.messageHandlers.set(agentName, handlers);
  }

  /**
   * Remove a message handler.
   */
  offMessage(agentName: string, handler: (msg: AgentMessage) => void): void {
    const handlers = this.messageHandlers.get(agentName) || [];
    const idx = handlers.indexOf(handler);
    if (idx >= 0) {
      handlers.splice(idx, 1);
      this.messageHandlers.set(agentName, handlers);
    }
  }

  /**
   * Delegate a task to a single subagent.
   * Supports three execution modes: in-process, child, remote
   */
  async delegate(config: SubagentConfig, task: string, parentContext: AgentContext): Promise<SubagentResult> {
    const start = Date.now();
    const mode = config.mode || "in-process";

    // Initialize metrics
    const metrics: AgentMetrics = {
      agentId: config.name,
      startTime: start,
      toolCalls: 0,
      tokensUsed: 0,
      messagesExchanged: 0,
      errors: 0,
      duration: 0,
    };
    this.metrics.set(config.name, metrics);

    // Setup worktree if enabled
    let worktreePath: string | undefined;
    if (config.worktree?.enabled) {
      worktreePath = await this.setupWorktree(config.name, config.worktree);
    }

    try {
      let result: SubagentResult;

      switch (mode) {
        case "in-process":
          result = await this.runInProcess(config, task, parentContext, metrics);
          break;
        case "child":
          result = await this.runChildProcess(config, task, parentContext, metrics);
          break;
        case "remote":
          result = await this.runRemote(config, task, parentContext, metrics);
          break;
        default:
          throw new Error(`Unknown subagent mode: ${mode}`);
      }

      // Update result with additional metadata
      result.mode = mode;
      result.metrics = { ...metrics, duration: Date.now() - start };
      result.worktreePath = worktreePath;

      return result;
    } finally {
      this.activeSubagents.delete(config.name);
      this.childProcesses.delete(config.name);

      // Cleanup worktree unless keepOnComplete is set
      if (worktreePath && !config.worktree?.keepOnComplete) {
        await this.cleanupWorktree(worktreePath);
      }
    }
  }

  /**
   * Run subagent in-process (original behavior).
   */
  private async runInProcess(
    config: SubagentConfig,
    task: string,
    parentContext: AgentContext,
    metrics: AgentMetrics,
  ): Promise<SubagentResult> {
    const start = Date.now();
    const events: AgentEvent[] = [];
    const abortController = new AbortController();
    this.activeSubagents.set(config.name, abortController);

    try {
      // Build subagent context
      const subContext = this.buildContext(config, parentContext);

      // Build input
      const input: AgentInput = {
        message: task,
        history: config.contextMode === "shared"
          ? this.getSharedHistory(config.name)
          : [],
      };

      // Record task on blackboard
      this.blackboard.set(`task:${config.name}`, task, "subagent-manager");
      this.blackboard.postMessage("subagent-manager", config.name, `Delegated: ${task}`);

      // Send task delegation message
      await this.sendMessage({
        id: `task-${Date.now()}`,
        from: "subagent-manager",
        to: config.name,
        type: "task",
        payload: { task, config },
        timestamp: Date.now(),
      });

      // Run with timeout
      const timeout = config.timeout || 300_000; // 5 min default
      const result = await Promise.race([
        this.runAgent(config.agent, input, subContext, events, metrics),
        this.timeoutPromise(timeout, config.name),
      ]);

      if (result === "timeout") {
        metrics.errors++;
        return {
          name: config.name,
          success: false,
          events,
          duration: Date.now() - start,
          error: `Subagent timed out after ${timeout}ms`,
        };
      }

      // Record findings on blackboard
      this.blackboard.recordFindings(config.name, events);

      // Send result message
      await this.sendMessage({
        id: `result-${Date.now()}`,
        from: config.name,
        to: "subagent-manager",
        type: "result",
        payload: { success: true, events },
        timestamp: Date.now(),
      });

      return {
        name: config.name,
        success: true,
        events,
        duration: Date.now() - start,
      };
    } catch (e) {
      metrics.errors++;
      return {
        name: config.name,
        success: false,
        events,
        duration: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /**
   * Run subagent as child process with MCP JSON-RPC over stdio.
   * D1: Cross-process Subagent with MCP Stdio reuse
   */
  private async runChildProcess(
    config: SubagentConfig,
    task: string,
    _parentContext: AgentContext,
    metrics: AgentMetrics,
  ): Promise<SubagentResult> {
    const start = Date.now();
    const events: AgentEvent[] = [];

    // Check recursion depth
    const currentDepth = this.getRecursionDepth();
    if (currentDepth >= 3) {
      return {
        name: config.name,
        success: false,
        events,
        duration: 0,
        error: `Recursion depth exceeded: ${currentDepth}/3`,
      };
    }

    return new Promise((resolve) => {
      // Get the path to the subagent-worker module
      const workerPath = new URL("./subagent-worker.js", import.meta.url).pathname;

      // Spawn child process with MCP worker
      const child = spawn(process.execPath, [workerPath], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ROOKIE_SUBAGENT_NAME: config.name,
          ROOKIE_SUBAGENT_TASK: task,
          ROOKIE_SUBAGENT_DEPTH: String(currentDepth + 1),
          ROOKIE_QUERY_SOURCE: "subagent",
        },
      });

      this.childProcesses.set(config.name, child);

      let buffer = "";
      let pendingRequests = new Map<string | number, { resolve: (result: unknown) => void; reject: (err: Error) => void }>();
      let requestId = 0;
      let isReady = false;

      // Helper to send JSON-RPC request
      const sendRequest = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
        return new Promise((resolveReq, rejectReq) => {
          const id = ++requestId;
          const request = {
            jsonrpc: "2.0",
            id,
            method,
            params,
          };

          pendingRequests.set(id, { resolve: resolveReq, reject: rejectReq });

          // Set timeout for request
          setTimeout(() => {
            if (pendingRequests.has(id)) {
              pendingRequests.delete(id);
              rejectReq(new Error(`Request timeout: ${method}`));
            }
          }, config.timeout || 300_000);

          child.stdin?.write(JSON.stringify(request) + "\n");
        });
      };

      // Helper to send notification
      const sendNotification = (method: string, params?: Record<string, unknown>): void => {
        const notification = {
          jsonrpc: "2.0",
          method,
          params,
        };
        child.stdin?.write(JSON.stringify(notification) + "\n");
      };

      // Process stdout data (JSON-RPC responses and notifications)
      child.stdout?.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const message = JSON.parse(trimmed) as {
              jsonrpc: "2.0";
              id?: string | number;
              method?: string;
              params?: Record<string, unknown>;
              result?: unknown;
              error?: { code: number; message: string };
            };

            // Handle responses
            if (message.id !== undefined) {
              const pending = pendingRequests.get(message.id);
              if (pending) {
                pendingRequests.delete(message.id);
                if (message.error) {
                  pending.reject(new Error(message.error.message));
                } else {
                  pending.resolve(message.result);
                }
              }
            }
            // Handle notifications
            else if (message.method) {
              switch (message.method) {
                case "subagent/ready":
                  isReady = true;
                  break;

                case "subagent/event": {
                  const event = message.params?.event as AgentEvent;
                  if (event) {
                    events.push(event);
                    // Update metrics based on event type
                    switch (event.type) {
                      case "tool_call":
                        metrics.toolCalls++;
                        break;
                      case "response":
                        metrics.messagesExchanged++;
                        metrics.tokensUsed += Math.ceil(event.content.length / 4);
                        break;
                      case "error":
                        metrics.errors++;
                        break;
                    }
                  }
                  break;
                }

                case "subagent/exiting":
                  // Worker is shutting down
                  break;

                case "subagent/heartbeatAck":
                  // Heartbeat acknowledged
                  break;
              }
            }
          } catch (e) {
            // Malformed JSON - ignore
          }
        }
      });

      child.stderr?.on("data", (_data: Buffer) => {
        // Log stderr errors
        metrics.errors++;
      });

      child.on("exit", (_code) => {
        this.childProcesses.delete(config.name);

        // Clear any pending requests
        for (const [, pending] of pendingRequests) {
          pending.reject(new Error("Child process exited"));
        }
        pendingRequests.clear();
      });

      child.on("error", (err) => {
        metrics.errors++;
        resolve({
          name: config.name,
          success: false,
          events,
          duration: Date.now() - start,
          error: `Failed to spawn child process: ${err.message}`,
        });
      });

      // Main execution flow
      const runWorker = async (): Promise<void> => {
        try {
          // Wait for ready notification
          await new Promise<void>((resolveReady, rejectReady) => {
            const checkReady = setInterval(() => {
              if (isReady) {
                clearInterval(checkReady);
                clearTimeout(timeout);
                resolveReady();
              }
            }, 50);

            const timeout = setTimeout(() => {
              clearInterval(checkReady);
              rejectReady(new Error("Worker failed to become ready"));
            }, 10000);
          });

          // Initialize worker
          await sendRequest("subagent/init", { config, task });

          // Run the task
          const result = await sendRequest("subagent/run") as SubagentResult;

          // Shutdown worker gracefully
          sendNotification("subagent/shutdown");

          const duration = Date.now() - start;
          metrics.duration = duration;

          resolve({
            ...result,
            name: config.name,
            duration,
            mode: "child",
            metrics: { ...metrics },
          });
        } catch (e) {
          const duration = Date.now() - start;
          metrics.errors++;

          // Try to kill the child
          child.kill("SIGTERM");

          resolve({
            name: config.name,
            success: false,
            events,
            duration,
            mode: "child",
            metrics: { ...metrics },
            error: e instanceof Error ? e.message : String(e),
          });
        }
      };

      // Start execution
      runWorker();

      // Timeout handling
      const timeout = config.timeout || 300_000;
      setTimeout(() => {
        if (this.childProcesses.has(config.name)) {
          child.kill("SIGTERM");
          metrics.errors++;

          // Give it a moment to exit, then force kill
          setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGKILL");
            }
          }, 5000);
        }
      }, timeout);
    });
  }

  /**
   * Get current recursion depth from environment.
   */
  private getRecursionDepth(): number {
    const depth = parseInt(process.env.ROOKIE_SUBAGENT_DEPTH || "0", 10);
    return isNaN(depth) ? 0 : depth;
  }

  /**
   * Run subagent remotely via HTTP/MCP.
   */
  private async runRemote(
    config: SubagentConfig,
    task: string,
    _parentContext: AgentContext,
    metrics: AgentMetrics,
  ): Promise<SubagentResult> {
    const start = Date.now();
    const events: AgentEvent[] = [];

    if (!config.remoteEndpoint) {
      return {
        name: config.name,
        success: false,
        events,
        duration: 0,
        error: "Remote endpoint not configured",
      };
    }

    try {
      // Send task to remote endpoint
      const response = await fetch(config.remoteEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent: config.name,
          task,
          systemPrompt: config.systemPrompt,
          allowedTools: config.allowedTools,
        }),
      });

      if (!response.ok) {
        metrics.errors++;
        return {
          name: config.name,
          success: false,
          events,
          duration: Date.now() - start,
          error: `Remote request failed: ${response.status} ${response.statusText}`,
        };
      }

      const result = await response.json();
      metrics.messagesExchanged++;

return {
        name: config.name,
        success: (result as { success?: boolean })?.success ?? true,
        events: (result as { events?: typeof events })?.events || events,
        duration: Date.now() - start,
      };
    } catch (e) {
      metrics.errors++;
      return {
        name: config.name,
        success: false,
        events,
        duration: Date.now() - start,
        error: `Remote request error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  /**
   * Delegate tasks to multiple subagents in parallel.
   * Returns results in the same order as the input tasks.
   */
  async delegateParallel(tasks: SubagentTask[], parentContext: AgentContext): Promise<SubagentResult[]> {
    const promises = tasks.map((t) =>
      this.delegate(t.config, t.task, parentContext)
    );
    return Promise.all(promises);
  }

  /**
   * Stream events from a subagent delegation.
   */
  async *delegateStream(
    config: SubagentConfig,
    task: string,
    parentContext: AgentContext
  ): AsyncGenerator<AgentEvent> {
    const subContext = this.buildContext(config, parentContext);
    const input: AgentInput = {
      message: task,
      history: config.contextMode === "shared"
        ? this.getSharedHistory(config.name)
        : [],
    };

    this.blackboard.set(`task:${config.name}`, task, "subagent-manager");

    yield { type: "thinking", content: `Delegating to subagent: ${config.name}` };

    try {
      for await (const event of config.agent.run(input, subContext)) {
        yield event;
        // Also record on blackboard for shared mode
        if (config.contextMode === "shared") {
          if (event.type === "response") {
            this.blackboard.postMessage(config.name, "*", event.content);
          }
        }
      }
    } catch (e) {
      yield { type: "error", error: `Subagent ${config.name} failed: ${e}` };
    }
  }

  /**
   * Cancel a running subagent.
   */
  cancel(name: string): boolean {
    const controller = this.activeSubagents.get(name);
    if (controller) {
      controller.abort();
      this.activeSubagents.delete(name);
      return true;
    }
    return false;
  }

  /**
   * List active subagents.
   */
  listActive(): string[] {
    return Array.from(this.activeSubagents.keys());
  }

  // ── Internal ──────────────────────────────────────────

  private buildContext(config: SubagentConfig, parentContext: AgentContext): AgentContext {
    // Fork or share tools
    let tools = parentContext.tools;
    if (config.allowedTools && config.allowedTools.length > 0) {
      // Create a restricted ToolRegistry view
      tools = this.restrictTools(parentContext.tools, config.allowedTools);
    }

    return {
      ...parentContext,
      tools,
    };
  }

  /**
   * Create a restricted view of ToolRegistry that only exposes allowed tools.
   */
  private restrictTools(registry: ToolRegistry, allowedTools: string[]): ToolRegistry {
    // We create a wrapper that delegates to the original but filters
    const restricted = new ToolRegistry();
    const allowedSet = new Set(allowedTools);

    for (const tool of registry.list()) {
      if (allowedSet.has(tool.name)) {
        restricted.register(tool);
      }
    }

    return restricted;
  }

  private async runAgent(
    agent: Agent,
    input: AgentInput,
    context: AgentContext,
    events: AgentEvent[],
    metrics: AgentMetrics,
  ): Promise<"done"> {
    for await (const event of agent.run(input, context)) {
      events.push(event);

      // Collect metrics
      switch (event.type) {
        case "tool_call":
          metrics.toolCalls++;
          break;
        case "tool_result":
          if (event.duration) {
            metrics.duration += event.duration;
          }
          break;
        case "response":
          metrics.messagesExchanged++;
          // Estimate tokens (rough approximation)
          metrics.tokensUsed += Math.ceil(event.content.length / 4);
          break;
        case "error":
          metrics.errors++;
          break;
      }
    }
    return "done";
  }

  // ─── Worktree Support (D2) ─────────────────────────────────────────

  /**
   * Setup git worktree for isolated execution.
   * D2: Enhanced with fail-closed policy and sparse checkout support.
   */
  private async setupWorktree(name: string, config: WorktreeConfig): Promise<string> {
    const { enterWorktreeTool } = await import("../tools/builtin/git.js");

    const slug = `${name}-${Date.now()}`;
    const result = await enterWorktreeTool.execute({
      slug,
      branch: config.branch,
      sparsePaths: config.sparsePaths,
      cwd: process.cwd(),
    });

    if (typeof result === "string" && result.startsWith("[ERROR]")) {
      // Fail-closed: throw error to abort task
      throw new Error(`Worktree setup failed: ${result}`);
    }

    try {
      const parsed = JSON.parse(String(result));
      return parsed.worktreePath;
    } catch {
      throw new Error(`Invalid worktree response: ${result}`);
    }
  }

  /**
   * Cleanup git worktree.
   * D2: Enhanced with cherry-pick support.
   */
  private async cleanupWorktree(worktreePath: string, config?: WorktreeConfig): Promise<void> {
    const { exitWorktreeTool } = await import("../tools/builtin/git.js");

    // Extract slug from path
    const match = worktreePath.match(/\/([^\/]+)$/);
    const slug = match ? match[1] : worktreePath;

    const result = await exitWorktreeTool.execute({
      slug,
      cherryPick: config?.cherryPickOnComplete ?? false,
      force: true, // Force remove on cleanup
      cwd: process.cwd(),
    });

    if (typeof result === "string" && result.startsWith("[ERROR]")) {
      console.error(`Worktree cleanup warning: ${result}`);
      // Don't throw on cleanup errors - best effort
    }
  }

  private timeoutPromise(ms: number, _name: string): Promise<"timeout"> {
    return new Promise((resolve) => {
      setTimeout(() => resolve("timeout"), ms);
    });
  }

  private getSharedHistory(agentName: string): Message[] {
    // Build history from blackboard messages
    return this.blackboard.getMessages(agentName).map((m) => ({
      role: "assistant" as const,
      content: `[${m.from}]: ${m.content}`,
    }));
  }
}
