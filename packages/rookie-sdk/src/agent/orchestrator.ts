import { Agent, AgentInput, AgentContext, AgentEvent, Message } from "./types.js";
import { SharedBlackboard } from "./blackboard.js";
import { SubagentManager, SubagentConfig, SubagentResult } from "./subagent.js";
import { Plan, makePlan, renderPlanMarkdown, MakePlanOptions } from "./planner.js";
import { EvaluationResult, evaluate, EvaluateOptions } from "./evaluator.js";
import { Logger } from "../logger/logger.js";

// ── Configuration ─────────────────────────────────────────

export interface AgentConfig {
  name: string;
  agent: Agent;
  priority: number;
  triggers: string[];
}

export type OrchestratorMode = "sequential" | "parallel" | "adaptive" | "gan" | "coordinator";

export interface OrchestratorEvent {
  type:
    | "agent_start"
    | "agent_complete"
    | "agent_error"
    | "handoff"
    | "broadcast"
    | "synthesis"
    | "mode_selected"
    | "plan_created"
    | "plan_revised"
    | "evaluation"
    | "gan_round"
    | "gan_done";
  agent: string;
  data?: unknown;
  error?: string;
}

// ── GAN mode types ────────────────────────────────────────

export interface GANRoundRecord {
  round: number;
  plan: Plan;
  output: string;
  evaluation: EvaluationResult;
}

export interface GANResult {
  passed: boolean;
  rounds: GANRoundRecord[];
  /** Shortcut to the last round's evaluation. */
  finalEvaluation: EvaluationResult;
}

export interface RunGANOptions {
  /** Name of a registered agent that produces output from a plan. Default: "coder". */
  generatorAgent?: string;
  /**
   * Override the default Generator behaviour. Useful in tests or when the
   * generator is not one of the registered ReAct agents.
   */
  generator?: (plan: Plan, context: AgentContext) => Promise<string>;
  /** Planner options (previous/critique are filled in by the loop itself). */
  plannerOptions?: MakePlanOptions;
  /** Evaluator options — threshold / weights / custom scorer. */
  evaluatorOptions?: Omit<EvaluateOptions, "plan" | "output">;
  /** Max GAN rounds before giving up. Default 3. */
  maxRounds?: number;
  /** Optional logger — every round writes `gan.round` / `gan.done`. */
  logger?: Logger;
}

// ── Coordinator mode types (D3) ───────────────────────────

/** D3: Worker tools whitelist - these are the only tools workers can use */
export const INTERNAL_WORKER_TOOLS = [
  "file_read",
  "grep",
  "glob",
  "search_code",
  "read",
] as const;

export type InternalWorkerTool = typeof INTERNAL_WORKER_TOOLS[number];

export interface CoordinatorTask {
  id: string;
  description: string;
  assignedTo?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  allowedTools: InternalWorkerTool[];
}

export interface CoordinatorScratchpad {
  sessionId: string;
  mainTask: string;
  subtasks: CoordinatorTask[];
  notes: string[];
  updatedAt: number;
}

export interface RunCoordinatorOptions {
  /** Max number of worker agents to spawn. Default 3. */
  maxWorkers?: number;
  /** Worker tool whitelist (default: INTERNAL_WORKER_TOOLS) */
  workerTools?: InternalWorkerTool[];
  /** Scratchpad file path (default: .rookie/scratchpad/<sessionId>.md) */
  scratchpadPath?: string;
  /** Logger for coordinator events */
  logger?: Logger;
}

export interface SharedContext {
  findings: Map<string, unknown>;
  messages: Message[];
  metadata: Record<string, unknown>;
}

// ── Main Orchestrator ──────────────────────────────────────

/**
 * AgentOrchestrator: coordinates multiple agents with different strategies.
 *
 * Modes:
 * - **sequential**: agents run one after another, each building on the previous
 * - **parallel**: agents run concurrently, results are synthesized
 * - **adaptive**: auto-selects sequential or parallel based on task analysis
 *
 * Inter-agent communication via SharedBlackboard.
 */
export class AgentOrchestrator {
  private agents = new Map<string, AgentConfig>();
  private blackboard: SharedBlackboard;
  private subagentManager: SubagentManager;
  private mode: OrchestratorMode;

  constructor(options?: { mode?: OrchestratorMode; blackboard?: SharedBlackboard }) {
    this.mode = options?.mode || "adaptive";
    this.blackboard = options?.blackboard || new SharedBlackboard();
    this.subagentManager = new SubagentManager(this.blackboard);
  }

  getBlackboard(): SharedBlackboard {
    return this.blackboard;
  }

  getSubagentManager(): SubagentManager {
    return this.subagentManager;
  }

  register(config: AgentConfig): void {
    this.agents.set(config.name, config);
  }

  unregister(name: string): boolean {
    return this.agents.delete(name);
  }

  listAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  getMode(): OrchestratorMode {
    return this.mode;
  }

  setMode(mode: OrchestratorMode): void {
    this.mode = mode;
  }

  // ── Single Agent ─────────────────────────────────────

  async *runSingle(
    agentName: string,
    input: AgentInput,
    context: AgentContext
  ): AsyncGenerator<AgentEvent | OrchestratorEvent> {
    const config = this.agents.get(agentName);
    if (!config) {
      yield { type: "agent_error", agent: agentName, error: `Agent not found: ${agentName}` };
      return;
    }

    yield { type: "agent_start", agent: agentName };

    try {
      const events: AgentEvent[] = [];
      for await (const event of config.agent.run(input, context)) {
        events.push(event);
        yield event;
      }
      this.blackboard.recordFindings(agentName, events);
      yield { type: "agent_complete", agent: agentName };
    } catch (e) {
      yield { type: "agent_error", agent: agentName, error: String(e) };
    }
  }

  // ── Sequential Pipeline ──────────────────────────────

  async *runSequential(
    agentNames: string[],
    input: AgentInput,
    context: AgentContext
  ): AsyncGenerator<AgentEvent | OrchestratorEvent> {
    let currentInput = input;

    for (const name of agentNames) {
      const config = this.agents.get(name);
      if (!config) {
        yield { type: "agent_error", agent: name, error: `Agent not found: ${name}` };
        continue;
      }

      yield { type: "agent_start", agent: name };

      // Inject blackboard context into agent input
      const enrichedInput = this.enrichInput(currentInput, name);

      try {
        const events: AgentEvent[] = [];
        for await (const event of config.agent.run(enrichedInput, context)) {
          events.push(event);
          yield event;
        }

        this.blackboard.recordFindings(name, events);

        // Prepare input for next agent
        currentInput = this.buildNextInput(name, events, currentInput);

        yield { type: "agent_complete", agent: name };

        // Post handoff message
        const nextIdx = agentNames.indexOf(name) + 1;
        if (nextIdx < agentNames.length) {
          this.blackboard.postMessage(name, agentNames[nextIdx], this.summarizeEvents(events));
          yield { type: "handoff", agent: name, data: { to: agentNames[nextIdx] } };
        }
      } catch (e) {
        yield { type: "agent_error", agent: name, error: String(e) };
      }
    }
  }

  // ── Parallel Execution ───────────────────────────────

  async *runParallel(
    agentNames: string[],
    input: AgentInput,
    context: AgentContext
  ): AsyncGenerator<AgentEvent | OrchestratorEvent> {
    // Delegate to subagent manager for parallel execution
    const tasks = agentNames.map((name) => {
      const config = this.agents.get(name);
      if (!config) return null;

      const subConfig: SubagentConfig = {
        name,
        agent: config.agent,
        contextMode: "shared",
        timeout: 120_000,
      };

      return { config: subConfig, task: input.message };
    }).filter(Boolean) as Array<{ config: SubagentConfig; task: string }>;

    // Emit start events
    for (const t of tasks) {
      yield { type: "agent_start", agent: t.config.name };
    }

    const results = await this.subagentManager.delegateParallel(tasks, context);

    // Emit results
    for (const result of results) {
      for (const event of result.events) {
        yield event;
      }
      if (result.success) {
        yield { type: "agent_complete", agent: result.name };
      } else {
        yield { type: "agent_error", agent: result.name, error: result.error };
      }
    }

    // Synthesize
    const synthesis = this.synthesizeResults(results);
    yield {
      type: "synthesis",
      agent: "orchestrator",
      data: { summary: synthesis },
    };
  }

  // ── Adaptive Mode ────────────────────────────────────

  async *runAdaptive(
    task: string,
    context: AgentContext
  ): AsyncGenerator<AgentEvent | OrchestratorEvent> {
    // Select participating agents
    const participants = this.selectAgents(task);
    if (participants.length === 0) {
      yield { type: "agent_error", agent: "orchestrator", error: "No suitable agents found" };
      return;
    }

    const input: AgentInput = { message: task, history: [] };

    // Decide mode based on task characteristics
    const needsSequential = this.requiresSequential(task, participants);
    const selectedMode = needsSequential ? "sequential" : "parallel";

    yield {
      type: "mode_selected",
      agent: "orchestrator",
      data: { mode: selectedMode, agents: participants },
    };

    if (selectedMode === "sequential") {
      yield* this.runSequential(participants, input, context);
    } else {
      yield* this.runParallel(participants, input, context);
    }
  }

  // ── Collaborative (backward compat) ──────────────────

  async *runCollaborative(
    task: string,
    context: AgentContext
  ): AsyncGenerator<AgentEvent | OrchestratorEvent> {
    yield* this.runAdaptive(task, context);
  }

  // ── Coordinator Mode (D3) ────────────────────────────

  /**
   * Coordinator mode: A coordinator agent splits tasks and delegates to workers.
   * Workers can only use INTERNAL_WORKER_TOOLS whitelist.
   *
   * D3: Coordinator mode with scratchpad and worker tool restrictions.
   */
  async *runCoordinator(
    task: string,
    context: AgentContext,
    options: RunCoordinatorOptions = {}
  ): AsyncGenerator<AgentEvent | OrchestratorEvent> {
    const maxWorkers = options.maxWorkers ?? 3;
    const workerTools = options.workerTools ?? [...INTERNAL_WORKER_TOOLS];
    const sessionId = `coord-${Date.now()}`;
    const scratchpadPath = options.scratchpadPath ?? `.rookie/scratchpad/${sessionId}.md`;
    const logger = options.logger;

    // Initialize scratchpad
    const scratchpad: CoordinatorScratchpad = {
      sessionId,
      mainTask: task,
      subtasks: [],
      notes: [],
      updatedAt: Date.now(),
    };

    yield {
      type: "mode_selected",
      agent: "orchestrator",
      data: { mode: "coordinator", maxWorkers, workerTools },
    };

    logger?.info("coordinator.start", { sessionId, task: task.slice(0, 100) });

    // Step 1: Coordinator analyzes task and creates subtasks
    yield { type: "agent_start", agent: "coordinator" };

    const subtasks = await this.splitTaskIntoSubtasks(task, maxWorkers);
    scratchpad.subtasks = subtasks.map((desc, idx) => ({
      id: `task-${idx + 1}`,
      description: desc,
      status: "pending",
      allowedTools: workerTools,
    }));

    await this.writeScratchpad(scratchpadPath, scratchpad);

    yield {
      type: "broadcast",
      agent: "coordinator",
      data: { subtasks: scratchpad.subtasks.map((s) => ({ id: s.id, description: s.description })) },
    };

    logger?.info("coordinator.tasks_created", { count: subtasks.length });

    // Step 2: Dispatch tasks to workers
    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < Math.min(subtasks.length, maxWorkers); i++) {
      const subtask = scratchpad.subtasks[i];
      const workerName = `worker-${i + 1}`;

      workerPromises.push(
        this.runWorker(workerName, subtask, context, scratchpad, scratchpadPath, logger)
          .then((result) => {
            subtask.status = result.success ? "completed" : "failed";
            subtask.result = result.output;
            if (result.success) {
              subtask.assignedTo = workerName;
            }
          })
          .catch((e) => {
            subtask.status = "failed";
            subtask.result = String(e);
          })
      );
    }

    // Wait for all workers to complete
    await Promise.all(workerPromises);

    // Update scratchpad
    scratchpad.updatedAt = Date.now();
    scratchpad.notes.push(`All ${subtasks.length} subtasks completed`);
    await this.writeScratchpad(scratchpadPath, scratchpad);

    yield { type: "agent_complete", agent: "coordinator" };

    // Step 3: Synthesize results
    const synthesis = this.synthesizeCoordinatorResults(scratchpad);
    yield {
      type: "synthesis",
      agent: "coordinator",
      data: { summary: synthesis, scratchpadPath },
    };

    const completedCount = scratchpad.subtasks.filter((s) => s.status === "completed").length;
    logger?.info("coordinator.done", { sessionId, completed: completedCount });
  }

  /**
   * Split a task into subtasks using simple heuristics.
   * In production, this would use an LLM to intelligently split tasks.
   */
  private async splitTaskIntoSubtasks(task: string, maxSubtasks: number): Promise<string[]> {
    // Simple heuristic-based splitting
    // In production, this would call an LLM to analyze and split the task

    const subtasks: string[] = [];

    // Check for obvious parallelizable patterns
    if (task.toLowerCase().includes("search") && task.toLowerCase().includes("and")) {
      // Split search tasks
      const parts = task.split(/\band\b/i).map((s) => s.trim());
      for (const part of parts.slice(0, maxSubtasks)) {
        if (part) subtasks.push(part);
      }
    }

    if (task.toLowerCase().includes("files")) {
      subtasks.push(`Find relevant files for: ${task}`);
    }

    if (task.toLowerCase().includes("analyze")) {
      subtasks.push(`Analyze code structure for: ${task}`);
    }

    // If no specific patterns, create generic subtasks
    if (subtasks.length === 0) {
      subtasks.push(task);
    }

    return subtasks.slice(0, maxSubtasks);
  }

  /**
   * Run a worker agent on a subtask with restricted tools.
   */
  private async runWorker(
    workerName: string,
    subtask: CoordinatorTask,
    context: AgentContext,
    scratchpad: CoordinatorScratchpad,
    scratchpadPath: string,
    logger?: Logger
  ): Promise<{ success: boolean; output: string }> {
    subtask.status = "running";
    await this.writeScratchpad(scratchpadPath, scratchpad);

    logger?.info("coordinator.worker_start", { worker: workerName, taskId: subtask.id });

    try {
      // Create restricted tool registry with only allowed tools
      const { ToolRegistry } = await import("../tools/registry.js");
      const restrictedTools = new ToolRegistry();

      // Import only allowed tools
      // Note: Individual tools should be imported here based on the whitelist
      // For now, we use dynamic imports for each tool
      for (const toolName of subtask.allowedTools) {
        try {
          const toolModule = await import(`../tools/builtin/${toolName}.js`);
          const tool = toolModule.default || toolModule[toolName];
          if (tool && typeof tool === "object" && "name" in tool) {
            restrictedTools.register(tool as any);
          }
        } catch {
          // Tool not found, skip
        }
      }

      // Create worker context with restricted tools
      const workerContext: AgentContext = {
        ...context,
        tools: restrictedTools,
      };

      // Simulate worker execution (in production, this would run an actual agent)
      // For now, we simulate the worker doing its task
      const output = await this.simulateWorkerExecution(workerName, subtask, workerContext);

      // Write to scratchpad
      scratchpad.notes.push(`[${workerName}] Completed ${subtask.id}: ${output.slice(0, 100)}...`);
      await this.writeScratchpad(scratchpadPath, scratchpad);

      logger?.info("coordinator.worker_complete", { worker: workerName, taskId: subtask.id });

      return { success: true, output };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logger?.error("coordinator.worker_error", { worker: workerName, taskId: subtask.id, error });
      return { success: false, output: error };
    }
  }

  /**
   * Simulate worker execution (placeholder for actual agent execution).
   */
  private async simulateWorkerExecution(
    workerName: string,
    subtask: CoordinatorTask,
    _context: AgentContext
  ): Promise<string> {
    // In production, this would:
    // 1. Create a worker agent with restricted tools
    // 2. Run the agent with the subtask description
    // 3. Collect and return the output

    // For now, return a simulated result
    return `Worker ${workerName} processed: ${subtask.description}\nUsed tools: ${subtask.allowedTools.join(", ")}`;
  }

  /**
   * Write scratchpad to disk.
   */
  private async writeScratchpad(path: string, scratchpad: CoordinatorScratchpad): Promise<void> {
    const fs = await import("fs/promises");
    const nodePath = await import("path");

    // Ensure directory exists
    await fs.mkdir(nodePath.dirname(path), { recursive: true });

    // Format as markdown
    const content = this.formatScratchpad(scratchpad);
    await fs.writeFile(path, content, "utf-8");
  }

  /**
   * Format scratchpad as markdown.
   */
  private formatScratchpad(scratchpad: CoordinatorScratchpad): string {
    const lines: string[] = [
      `# Coordinator Session: ${scratchpad.sessionId}`,
      "",
      `**Main Task:** ${scratchpad.mainTask}`,
      `**Updated:** ${new Date(scratchpad.updatedAt).toISOString()}`,
      "",
      "## Subtasks",
      "",
    ];

    for (const task of scratchpad.subtasks) {
      const statusEmoji = task.status === "completed" ? "✅" : task.status === "failed" ? "❌" : task.status === "running" ? "🔄" : "⏳";
      lines.push(`### ${statusEmoji} ${task.id}`);
      lines.push(`- **Description:** ${task.description}`);
      lines.push(`- **Status:** ${task.status}`);
      lines.push(`- **Allowed Tools:** ${task.allowedTools.join(", ")}`);
      if (task.assignedTo) {
        lines.push(`- **Assigned To:** ${task.assignedTo}`);
      }
      if (task.result) {
        lines.push(`- **Result:** ${task.result.slice(0, 500)}${task.result.length > 500 ? "..." : ""}`);
      }
      lines.push("");
    }

    lines.push("## Notes");
    lines.push("");
    for (const note of scratchpad.notes) {
      lines.push(`- ${note}`);
    }

    return lines.join("\n");
  }

  /**
   * Synthesize coordinator results into a final summary.
   */
  private synthesizeCoordinatorResults(scratchpad: CoordinatorScratchpad): string {
    const completed = scratchpad.subtasks.filter((s) => s.status === "completed");
    const failed = scratchpad.subtasks.filter((s) => s.status === "failed");

    const lines: string[] = [
      `## Coordinator Results`,
      "",
      `**Main Task:** ${scratchpad.mainTask}`,
      "",
      `**Summary:** ${completed.length}/${scratchpad.subtasks.length} subtasks completed`,
      "",
    ];

    if (completed.length > 0) {
      lines.push("### Completed Subtasks");
      for (const task of completed) {
        lines.push(`- **${task.id}:** ${task.description}`);
        if (task.result) {
          lines.push(`  - Result: ${task.result.slice(0, 200)}${task.result.length > 200 ? "..." : ""}`);
        }
      }
      lines.push("");
    }

    if (failed.length > 0) {
      lines.push("### Failed Subtasks");
      for (const task of failed) {
        lines.push(`- **${task.id}:** ${task.description}`);
        if (task.result) {
          lines.push(`  - Error: ${task.result.slice(0, 200)}`);
        }
      }
      lines.push("");
    }

    lines.push(`**Scratchpad:** ${`.rookie/scratchpad/${scratchpad.sessionId}.md`}`);

    return lines.join("\n");
  }

  // ── GAN mode (Planner → Generator → Evaluator) ───────

  /**
   * GAN loop: Planner drafts a plan, Generator executes it, Evaluator scores
   * the output. If the evaluation fails, the Planner revises the plan using
   * the critique and the loop retries up to `maxRounds` times.
   *
   * Events emitted per round:
   *   plan_created / plan_revised  (agent: "planner")
   *   agent_start / agent_complete (agent: generator name)
   *   evaluation                   (agent: "evaluator")
   *   gan_round                    (agent: "orchestrator")
   * Terminal event:
   *   gan_done                     (agent: "orchestrator", data: GANResult)
   */
  async *runGAN(
    task: string,
    context: AgentContext,
    options: RunGANOptions = {}
  ): AsyncGenerator<AgentEvent | OrchestratorEvent> {
    const maxRounds = options.maxRounds ?? 3;
    const generatorAgent = options.generatorAgent ?? "coder";
    const logger = options.logger;

    const rounds: GANRoundRecord[] = [];
    let currentPlan: Plan | undefined;
    let lastEvaluation: EvaluationResult | undefined;

    for (let round = 1; round <= maxRounds; round++) {
      // 1. Planner
      const plannerOpts: MakePlanOptions = {
        ...(options.plannerOptions ?? {}),
        previous: currentPlan,
        critique: lastEvaluation?.pass === false ? lastEvaluation.critique : undefined,
      };
      currentPlan = makePlan(task, plannerOpts);

      yield {
        type: currentPlan.revision === 1 ? "plan_created" : "plan_revised",
        agent: "planner",
        data: { plan: currentPlan, round },
      };
      logger?.info("gan.plan", {
        round,
        revision: currentPlan.revision,
        steps: currentPlan.steps.length,
      });

      // 2. Generator
      yield { type: "agent_start", agent: generatorAgent };
      let output = "";
      try {
        output = options.generator
          ? await options.generator(currentPlan, context)
          : await this.runGeneratorAgent(generatorAgent, currentPlan, context);
        yield { type: "agent_complete", agent: generatorAgent };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        yield { type: "agent_error", agent: generatorAgent, error: err };
        logger?.error("gan.generator_error", { round, error: err });
        break;
      }

      // 3. Evaluator
      const evalOpts: EvaluateOptions = {
        ...(options.evaluatorOptions ?? {}),
        plan: currentPlan,
        output,
      };
      const evaluation = evaluate(evalOpts);
      lastEvaluation = evaluation;
      rounds.push({ round, plan: currentPlan, output, evaluation });

      yield {
        type: "evaluation",
        agent: "evaluator",
        data: evaluation,
      };
      yield {
        type: "gan_round",
        agent: "orchestrator",
        data: { round, pass: evaluation.pass, overall: evaluation.overall, scores: evaluation.scores },
      };
      logger?.info("gan.round", {
        round,
        pass: evaluation.pass,
        overall: evaluation.overall,
        scores: evaluation.scores.map((s) => ({ axis: s.axis, score: s.score })),
      });

      if (evaluation.pass) {
        break;
      }
    }

    const passed = lastEvaluation?.pass ?? false;
    const result: GANResult = {
      passed,
      rounds,
      finalEvaluation:
        lastEvaluation ??
        ({ pass: false, overall: 0, scores: [], critique: "No evaluation produced" } as EvaluationResult),
    };

    yield { type: "gan_done", agent: "orchestrator", data: result };
    logger?.info("gan.done", { passed, rounds: rounds.length });
  }

  /**
   * Default Generator implementation: drive a registered agent with the plan
   * rendered as markdown; concatenate every `response` event as the output.
   */
  private async runGeneratorAgent(
    agentName: string,
    plan: Plan,
    context: AgentContext
  ): Promise<string> {
    const config = this.agents.get(agentName);
    if (!config) {
      throw new Error(`GAN generator agent not registered: ${agentName}`);
    }
    const input: AgentInput = {
      message: renderPlanMarkdown(plan),
      history: [],
    };
    const chunks: string[] = [];
    for await (const evt of config.agent.run(input, context)) {
      if (evt.type === "response" && evt.content) {
        chunks.push(evt.content);
      }
    }
    return chunks.join("").trim();
  }

  // ── Internal helpers ──────────────────────────────────

  private selectAgents(task: string): string[] {
    const selected: string[] = [];

    for (const [name, config] of this.agents) {
      for (const trigger of config.triggers) {
        if (task.toLowerCase().includes(trigger.toLowerCase())) {
          selected.push(name);
          break;
        }
      }
    }

    // If no specific match, include all agents sorted by priority
    if (selected.length === 0) {
      const all = Array.from(this.agents.values());
      all.sort((a, b) => b.priority - a.priority);
      return all.map((a) => a.name);
    }

    return selected;
  }

  /**
   * Determine if the task requires sequential execution.
   * Heuristic: tasks that involve code changes (write/edit/fix) need
   * sequential flow (architect → coder → reviewer).
   * Tasks that are read-only (search/analyze/review) can be parallel.
   */
  private requiresSequential(task: string, agents: string[]): boolean {
    const writeKeywords = ["fix", "implement", "create", "write", "refactor", "edit", "change", "update", "add"];
    const hasWriteIntent = writeKeywords.some((kw) => task.toLowerCase().includes(kw));
    const hasMultipleAgents = agents.length > 1;

    return hasWriteIntent && hasMultipleAgents;
  }

  private enrichInput(input: AgentInput, agentName: string): AgentInput {
    // Inject blackboard messages into context
    const messages = this.blackboard.getMessages(agentName);
    if (messages.length === 0) return input;

    const contextPrefix = messages
      .map((m) => `[${m.from}]: ${m.content}`)
      .join("\n");

    return {
      ...input,
      message: `Context from previous agents:\n${contextPrefix}\n\n---\n\n${input.message}`,
    };
  }

  private buildNextInput(
    agentName: string,
    events: AgentEvent[],
    previousInput: AgentInput
  ): AgentInput {
    const responses = events
      .filter((e) => e.type === "response")
      .map((e) => (e as any).content)
      .join("\n");

    return {
      message: previousInput.message,
      history: [
        ...previousInput.history,
        { role: "assistant" as const, content: `[${agentName}]: ${responses}` },
      ],
    };
  }

  private summarizeEvents(events: AgentEvent[]): string {
    const responses = events
      .filter((e) => e.type === "response")
      .map((e) => (e as any).content)
      .join("\n");
    return responses.slice(0, 2000) || "(no output)";
  }

  private synthesizeResults(results: SubagentResult[]): string {
    const parts: string[] = [];
    for (const result of results) {
      const responses = result.events
        .filter((e) => e.type === "response")
        .map((e) => (e as any).content)
        .join("\n");
      if (responses) {
        parts.push(`## ${result.name}\n${responses}`);
      } else if (!result.success) {
        parts.push(`## ${result.name}\n❌ Error: ${result.error}`);
      }
    }
    return parts.join("\n\n");
  }

  getSharedContext(): SharedContext {
    const findings = new Map<string, unknown>();
    const allFindings = this.blackboard.getAllFindings();
    for (const [k, v] of Object.entries(allFindings)) {
      findings.set(k, v);
    }
    return {
      findings,
      messages: this.blackboard.getAllMessages().map((m) => ({
        role: "assistant" as const,
        content: `[${m.from} → ${m.to}]: ${m.content}`,
      })),
      metadata: {},
    };
  }

  clearContext(): void {
    this.blackboard.clear();
  }
}
