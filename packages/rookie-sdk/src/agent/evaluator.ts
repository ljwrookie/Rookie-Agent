import { Agent, AgentInput, AgentContext, AgentEvent } from "./types.js";
import { runReAct } from "./react.js";
import { Plan } from "./planner.js";

// ─── Rubric ──────────────────────────────────────────────────

export type RubricAxis = "correctness" | "coverage" | "maintainability" | "style";

export const RUBRIC_AXES: readonly RubricAxis[] = [
  "correctness",
  "coverage",
  "maintainability",
  "style",
] as const;

export interface AxisScore {
  axis: RubricAxis;
  /** 0..1 */
  score: number;
  reason: string;
}

export interface EvaluationResult {
  pass: boolean;
  /** Weighted 0..1 score. */
  overall: number;
  scores: AxisScore[];
  critique: string;
  /** If `pass=false`, a hint the Planner can use to revise the plan. */
  retryHint?: string;
}

// ─── Pure evaluator ──────────────────────────────────────────

export interface EvaluateOptions {
  plan: Plan;
  /** Generator's final output — code, diff, markdown, whatever it produced. */
  output: string;
  /** Pass threshold on the overall score, default 0.7. */
  threshold?: number;
  /** Per-axis weights. Missing axes default to 1. */
  weights?: Partial<Record<RubricAxis, number>>;
  /** Override the default heuristic scorer. */
  scorer?: (axis: RubricAxis, opts: EvaluateOptions) => AxisScore;
}

const DEFAULT_WEIGHTS: Record<RubricAxis, number> = {
  correctness: 1.2,
  coverage: 1.0,
  maintainability: 0.9,
  style: 0.6,
};

/**
 * Heuristic rubric scorer — framework-free. Good enough to exercise the
 * GAN loop in tests and to keep the system working before an LLM-backed
 * evaluator is plugged in via `opts.scorer`.
 */
export function evaluate(opts: EvaluateOptions): EvaluationResult {
  const threshold = opts.threshold ?? 0.7;
  const scorer = opts.scorer ?? defaultScorer;

  const scores: AxisScore[] = RUBRIC_AXES.map((axis) => scorer(axis, opts));

  const weights: Record<RubricAxis, number> = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  let weightSum = 0;
  let weighted = 0;
  for (const s of scores) {
    const w = weights[s.axis] ?? 1;
    weightSum += w;
    weighted += s.score * w;
  }
  const overall = weightSum === 0 ? 0 : weighted / weightSum;
  const pass = overall >= threshold;

  const failing = scores.filter((s) => s.score < threshold);
  const critique = buildCritique(scores, overall, threshold);
  const retryHint = pass
    ? undefined
    : failing.length > 0
    ? `Focus on: ${failing.map((s) => `${s.axis} (${s.reason})`).join("; ")}`
    : `Overall score ${(overall * 100).toFixed(0)}% below ${(threshold * 100).toFixed(0)}% threshold`;

  return { pass, overall, scores, critique, retryHint };
}

function defaultScorer(axis: RubricAxis, opts: EvaluateOptions): AxisScore {
  const out = opts.output ?? "";
  const plan = opts.plan;

  switch (axis) {
    case "correctness": {
      // Empty output clearly fails; presence of "error"/"TODO" penalises.
      if (!out.trim()) {
        return { axis, score: 0, reason: "Generator produced no output" };
      }
      const errorLike = /(\bTODO\b|\bFIXME\b|\bplaceholder\b|\bnot implemented\b)/i.test(out);
      const mentionsGoal = plan.goal && out.toLowerCase().includes(plan.goal.toLowerCase().slice(0, 30));
      let score = 0.75;
      if (mentionsGoal) score += 0.15;
      if (errorLike) score -= 0.3;
      score = clamp01(score);
      return {
        axis,
        score,
        reason: errorLike
          ? "Output contains TODO/FIXME/placeholder markers"
          : mentionsGoal
          ? "Output appears to address the stated goal"
          : "Output present but not clearly tied to the goal",
      };
    }
    case "coverage": {
      if (plan.steps.length === 0) {
        return { axis, score: 1, reason: "Plan has no steps to cover" };
      }
      const lower = out.toLowerCase();
      const hit = plan.steps.filter((s) => lower.includes(s.title.toLowerCase().slice(0, 20))).length;
      const ratio = hit / plan.steps.length;
      return {
        axis,
        score: clamp01(ratio),
        reason: `Mentioned ${hit}/${plan.steps.length} plan steps`,
      };
    }
    case "maintainability": {
      const lines = out.split(/\n/).length;
      // Very short OR extremely long outputs bias toward lower scores.
      let score = 0.8;
      if (lines < 3) score = 0.4;
      else if (lines > 400) score = 0.5;
      return {
        axis,
        score,
        reason: lines < 3 ? "Output too short to be substantive" : lines > 400 ? "Output very large — risk of sprawl" : "Output size in a reasonable range",
      };
    }
    case "style": {
      const hasHeadings = /(^|\n)#+\s/.test(out) || /(^|\n)[A-Z][^\n]{0,80}:\n/.test(out);
      return {
        axis,
        score: hasHeadings ? 0.85 : 0.6,
        reason: hasHeadings ? "Output is structured with headings/sections" : "Output lacks structural cues",
      };
    }
  }
}

function buildCritique(scores: AxisScore[], overall: number, threshold: number): string {
  const parts: string[] = [];
  parts.push(`Overall: ${(overall * 100).toFixed(0)}% (threshold ${(threshold * 100).toFixed(0)}%)`);
  for (const s of scores) {
    parts.push(`- ${s.axis}: ${(s.score * 100).toFixed(0)}% — ${s.reason}`);
  }
  return parts.join("\n");
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ─── Evaluator Agent (ReAct-backed) ──────────────────────────

export class EvaluatorAgent implements Agent {
  name = "evaluator";
  description = "Scores generator output against a plan's acceptance criteria";
  systemPrompt = `You are a strict evaluator. Given a Plan and the Generator's output, score on four axes (0..1):
- **correctness**: does the output do what the goal says?
- **coverage**: does it address every step in the plan?
- **maintainability**: is it the right size / structure / clarity?
- **style**: does it follow sensible formatting conventions?

Return a short critique and a retry hint if anything scores below 0.7.`;

  tools = ["file_read", "search_code", "git_diff"];

  async *run(input: AgentInput, context: AgentContext): AsyncGenerator<AgentEvent> {
    yield* runReAct(this, input, context);
  }
}
