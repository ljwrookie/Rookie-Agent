import { Agent, AgentInput, AgentContext, AgentEvent } from "./types.js";
import { runReAct } from "./react.js";

// ─── Plan shape ──────────────────────────────────────────────

export interface PlanStep {
  /** 1-based step index — set by `makePlan`. */
  id: number;
  title: string;
  /** Free-form detail. Multiple lines are fine. */
  detail?: string;
  /** Optional file paths / modules the step will touch. */
  touches?: string[];
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
  /** Acceptance criteria — checked by the Evaluator. */
  acceptance: string[];
  risks: string[];
  /**
   * Plan revision number. `makePlan` with `previous` increments it; initial
   * plans start at 1.
   */
  revision: number;
  /** Optional free-form notes from the Planner (e.g. retry rationale). */
  notes?: string;
}

// ─── Planner function (GAN-friendly) ─────────────────────────

export interface MakePlanOptions {
  /** Previous plan being revised (on Evaluator rejection). */
  previous?: Plan;
  /** Evaluator feedback that triggered the revision, if any. */
  critique?: string;
  /** Override the default rule-based planner. */
  planner?: (task: string, opts: MakePlanOptions) => Plan;
}

/**
 * Default plan synthesis: pure heuristics — good enough for tests and for
 * wiring the GAN loop before a real LLM planner is plugged in. Caller can
 * swap in any `(task, opts) => Plan` function via `opts.planner`.
 */
export function makePlan(task: string, opts: MakePlanOptions = {}): Plan {
  if (opts.planner) {
    const plan = opts.planner(task, opts);
    return normalisePlan(plan);
  }

  const previous = opts.previous;
  const critique = opts.critique?.trim();

  // Derive "what to do" bullets from the task sentence; fall back to a
  // single-step plan.
  const sentences = task
    .split(/[\.\n;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const stepTitles = sentences.length > 0 ? sentences : [task.trim() || "Address user request"];

  const steps: PlanStep[] = stepTitles.map((title, idx) => ({
    id: idx + 1,
    title,
  }));

  const acceptance = [
    "Generator output addresses every step above",
    "No unresolved TODOs or placeholder markers remain",
    "Tests / smoke checks referenced in the task (if any) are green",
  ];

  const risks = [
    "Task description is ambiguous — clarify before large edits",
    "Generator may touch files outside scope — keep changes minimal",
  ];

  const plan: Plan = {
    goal: task.trim(),
    steps,
    acceptance,
    risks,
    revision: previous ? previous.revision + 1 : 1,
    notes: critique ? `Revised after critique: ${critique}` : undefined,
  };

  return plan;
}

/** Serialize a plan to markdown — useful as generator input. */
export function renderPlanMarkdown(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# Plan (rev ${plan.revision})`);
  lines.push("");
  lines.push(`**Goal**: ${plan.goal}`);
  lines.push("");
  lines.push("## Steps");
  for (const step of plan.steps) {
    lines.push(`${step.id}. ${step.title}`);
    if (step.detail) {
      lines.push(`   - ${step.detail.replace(/\n/g, "\n   - ")}`);
    }
    if (step.touches && step.touches.length > 0) {
      lines.push(`   - touches: ${step.touches.join(", ")}`);
    }
  }
  lines.push("");
  lines.push("## Acceptance");
  for (const a of plan.acceptance) lines.push(`- ${a}`);
  lines.push("");
  lines.push("## Risks");
  for (const r of plan.risks) lines.push(`- ${r}`);
  if (plan.notes) {
    lines.push("");
    lines.push("## Notes");
    lines.push(plan.notes);
  }
  return lines.join("\n");
}

function normalisePlan(plan: Plan): Plan {
  return {
    ...plan,
    steps: plan.steps.map((s, idx) => ({ ...s, id: s.id ?? idx + 1 })),
    revision: plan.revision ?? 1,
  };
}

// ─── Planner Agent (ReAct-backed) ────────────────────────────

/**
 * PlannerAgent: ReAct wrapper so the Planner can also be driven by an LLM
 * when used stand-alone. The Orchestrator's GAN loop prefers the pure
 * `makePlan` function for determinism; both coexist.
 */
export class PlannerAgent implements Agent {
  name = "planner";
  description = "Breaks a task into ordered steps with acceptance criteria and risks";
  systemPrompt = `You are a senior planner. Given a task, produce:
1. **Goal** (one sentence)
2. **Steps** (numbered list, each step an actionable deliverable)
3. **Acceptance** (verifiable criteria, 2-5 items)
4. **Risks** (things that could invalidate the plan)

Guidelines:
- Prefer 3-7 steps. Split large steps.
- Acceptance must be observable (tests pass, file exists, function returns X).
- Do not write code yourself — that is the Generator's job.
- If revising after critique, keep what worked and fix only what the critique calls out.`;

  tools = ["file_read", "search_code"];

  async *run(input: AgentInput, context: AgentContext): AsyncGenerator<AgentEvent> {
    yield* runReAct(this, input, context);
  }
}
