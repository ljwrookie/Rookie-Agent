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
  contextMode: "fork" | "shared";  // fork = isolated context, shared = same blackboard
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
   * Run subagent as child process.
   */
  private async runChildProcess(
    config: SubagentConfig,
    task: string,
    _parentContext: AgentContext,
    metrics: AgentMetrics,
  ): Promise<SubagentResult> {
    const start = Date.now();
    const events: AgentEvent[] = [];

    return new Promise((resolve) => {
      // Spawn child process
      const child = spawn(process.execPath, [
        "--eval",
        `
          const { SubagentWorker } = require('./subagent-worker');
          const worker = new SubagentWorker();
          worker.run(${JSON.stringify({ task, config })});
        `,
      ], {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ROOKIE_SUBAGENT_NAME: config.name,
          ROOKIE_SUBAGENT_TASK: task,
        },
      });

      this.childProcesses.set(config.name, child);

      let output = "";
      let errorOutput = "";

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
        events.push({ type: "thinking", content: data.toString() });
        metrics.messagesExchanged++;
      });

      child.stderr?.on("data", (data: Buffer) => {
        errorOutput += data.toString();
        metrics.errors++;
      });

      child.on("close", (code) => {
        const duration = Date.now() - start;
        this.childProcesses.delete(config.name);

        if (code === 0) {
          resolve({
            name: config.name,
            success: true,
            events,
            duration,
          });
        } else {
          resolve({
            name: config.name,
            success: false,
            events,
            duration,
            error: `Child process exited with code ${code}: ${errorOutput}`,
          });
        }
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

      // Timeout handling
      const timeout = config.timeout || 300_000;
      setTimeout(() => {
        child.kill("SIGTERM");
        metrics.errors++;
        resolve({
          name: config.name,
          success: false,
          events,
          duration: Date.now() - start,
          error: `Child process timed out after ${timeout}ms`,
        });
      }, timeout);
    });
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

  // ─── Worktree Support ─────────────────────────────────────────

  /**
   * Setup git worktree for isolated execution.
   */
  private async setupWorktree(name: string, config: WorktreeConfig): Promise<string> {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const worktreePath = config.path || `.rookie/worktrees/${name}-${Date.now()}`;
    const branch = config.branch || `subagent/${name}`;

    try {
      // Create worktree
      await execAsync(`git worktree add -b ${branch} ${worktreePath}`);
      return worktreePath;
    } catch (e) {
      console.error(`Failed to setup worktree: ${e}`);
      // Fallback to regular directory
      const fs = await import("fs/promises");
      await fs.mkdir(worktreePath, { recursive: true });
      return worktreePath;
    }
  }

  /**
   * Cleanup git worktree.
   */
  private async cleanupWorktree(worktreePath: string): Promise<void> {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      // Remove worktree
      await execAsync(`git worktree remove ${worktreePath} --force`);
    } catch (e) {
      console.error(`Failed to cleanup worktree: ${e}`);
      // Try to remove directory manually
      try {
        const fs = await import("fs/promises");
        await fs.rm(worktreePath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
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
