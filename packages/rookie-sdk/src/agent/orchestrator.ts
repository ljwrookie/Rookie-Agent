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

export type OrchestratorMode = "sequential" | "parallel" | "adaptive" | "gan";

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
