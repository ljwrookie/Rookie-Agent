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

// ─── LLM-as-Judge (D7) ─────────────────────────────────────

export interface LLMJudgeOptions {
  /** The plan being evaluated */
  plan: Plan;
  /** The generator's output */
  output: string;
  /** The rubric/criteria for evaluation */
  rubric?: string;
  /** Model provider for evaluation */
  modelProvider?: AgentContext["model"];
  /** Pass threshold (default 0.7) */
  threshold?: number;
}

export interface LLMJudgeResult {
  score: number;
  reasoning: string;
  passed: boolean;
  critique: string;
  retryHint?: string;
}

export interface PairwiseComparisonOptions {
  /** The plan being evaluated */
  plan: Plan;
  /** Output A */
  outputA: string;
  /** Output B */
  outputB: string;
  /** The rubric/criteria for evaluation */
  rubric?: string;
  /** Model provider for evaluation */
  modelProvider?: AgentContext["model"];
}

export interface PairwiseComparisonResult {
  preference: "A" | "B" | "tie";
  reasoning: string;
  scoreA: number;
  scoreB: number;
}

/**
 * LLM-as-Judge evaluator.
 * D7: Uses LLM to evaluate output quality against a rubric.
 */
export async function llmJudge(
  options: LLMJudgeOptions,
  context: AgentContext
): Promise<LLMJudgeResult> {
  const threshold = options.threshold ?? 0.7;

  const prompt = buildLLMJudgePrompt(options.plan, options.output, options.rubric);

  // Use the model provider if available, otherwise return fallback
  if (!context.model) {
    // Fallback to heuristic evaluator
    const heuristicResult = evaluate({
      plan: options.plan,
      output: options.output,
      threshold,
    });

    return {
      score: heuristicResult.overall,
      reasoning: "Heuristic evaluation (no LLM provider)",
      passed: heuristicResult.pass,
      critique: heuristicResult.critique,
      retryHint: heuristicResult.retryHint,
    };
  }

  try {
    // Call LLM for evaluation
    const response = await context.model.chat([
      {
        role: "system",
        content: `You are an expert evaluator. Evaluate the output against the plan using the provided rubric.
Respond with a JSON object in this exact format:
{
  "score": 0.0 to 1.0,
  "passed": true/false,
  "reasoning": "detailed explanation of scoring",
  "critique": "constructive feedback",
  "retryHint": "specific advice for improvement (if failed)"
}`,
      },
      { role: "user", content: prompt },
    ]);

    // Parse JSON response
    const content = response.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const result = JSON.parse(jsonMatch[0]) as {
      score: number;
      passed: boolean;
      reasoning: string;
      critique: string;
      retryHint?: string;
    };

    return {
      score: clamp01(result.score),
      reasoning: result.reasoning,
      passed: result.passed ?? result.score >= threshold,
      critique: result.critique,
      retryHint: result.retryHint,
    };
  } catch (e) {
    // Fallback to heuristic on error
    const heuristicResult = evaluate({
      plan: options.plan,
      output: options.output,
      threshold,
    });

    return {
      score: heuristicResult.overall,
      reasoning: `LLM evaluation failed (${e instanceof Error ? e.message : String(e)}), using heuristic fallback`,
      passed: heuristicResult.pass,
      critique: heuristicResult.critique,
      retryHint: heuristicResult.retryHint,
    };
  }
}

/**
 * Pairwise comparison using LLM-as-Judge.
 * D7: Compares two outputs and returns which is better.
 */
export async function llmJudgePairwise(
  options: PairwiseComparisonOptions,
  context: AgentContext
): Promise<PairwiseComparisonResult> {
  const prompt = buildPairwisePrompt(options.plan, options.outputA, options.outputB, options.rubric);

  if (!context.model) {
    // Fallback: compare lengths as a simple heuristic
    const lenA = options.outputA.length;
    const lenB = options.outputB.length;
    const preference = lenA > lenB * 1.2 ? "A" : lenB > lenA * 1.2 ? "B" : "tie";

    return {
      preference,
      reasoning: "Heuristic comparison (no LLM provider) - comparing output lengths",
      scoreA: preference === "A" ? 0.6 : preference === "tie" ? 0.5 : 0.4,
      scoreB: preference === "B" ? 0.6 : preference === "tie" ? 0.5 : 0.4,
    };
  }

  try {
    const response = await context.model.chat([
      {
        role: "system",
        content: `You are an expert evaluator. Compare Output A and Output B against the plan.
Respond with a JSON object in this exact format:
{
  "preference": "A" | "B" | "tie",
  "reasoning": "detailed explanation of your choice",
  "scoreA": 0.0 to 1.0,
  "scoreB": 0.0 to 1.0
}`,
      },
      { role: "user", content: prompt },
    ]);

    const content = response.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in LLM response");
    }

    const result = JSON.parse(jsonMatch[0]) as {
      preference: "A" | "B" | "tie";
      reasoning: string;
      scoreA: number;
      scoreB: number;
    };

    return {
      preference: result.preference,
      reasoning: result.reasoning,
      scoreA: clamp01(result.scoreA),
      scoreB: clamp01(result.scoreB),
    };
  } catch (e) {
    return {
      preference: "tie",
      reasoning: `Comparison failed (${e instanceof Error ? e.message : String(e)})`,
      scoreA: 0.5,
      scoreB: 0.5,
    };
  }
}

/**
 * EvaluatorAgent with LLM-as-Judge support.
 * D7: Enhanced evaluator that uses LLM for scoring.
 */
export class LLMJudgeEvaluatorAgent extends EvaluatorAgent {
  name = "llm-judge-evaluator";
  description = "Scores generator output using LLM-as-Judge";

  async *run(input: AgentInput, context: AgentContext): AsyncGenerator<AgentEvent> {
    // Parse input to extract plan and output
    const { plan, output, threshold } = parseEvaluationInput(input.message);

    yield { type: "thinking", content: "Evaluating output using LLM-as-Judge..." };

    const result = await llmJudge({ plan, output, threshold }, context);

    yield {
      type: "response",
      content: JSON.stringify(result, null, 2),
      done: true,
    };
  }
}

// ─── Helper Functions ────────────────────────────────────

function buildLLMJudgePrompt(plan: Plan, output: string, rubric?: string): string {
  const parts: string[] = [
    "# Evaluation Task",
    "",
    "## Plan",
    `Goal: ${plan.goal}`,
    "",
    "Steps:",
    ...plan.steps.map((s, i) => `${i + 1}. ${s.title}${s.detail ? `: ${s.detail}` : ""}`),
    "",
    "## Output to Evaluate",
    "```",
    output.slice(0, 8000), // Limit output size
    output.length > 8000 ? "\n... (truncated)" : "",
    "```",
    "",
  ];

  if (rubric) {
    parts.push("## Rubric", rubric, "");
  }

  parts.push(
    "Please evaluate the output against the plan using the rubric.",
    "Respond with a JSON object containing: score (0-1), passed (boolean), reasoning, critique, and retryHint."
  );

  return parts.join("\n");
}

function buildPairwisePrompt(plan: Plan, outputA: string, outputB: string, rubric?: string): string {
  const parts: string[] = [
    "# Pairwise Comparison Task",
    "",
    "## Plan",
    `Goal: ${plan.goal}`,
    "",
    "## Output A",
    "```",
    outputA.slice(0, 4000),
    outputA.length > 4000 ? "\n... (truncated)" : "",
    "```",
    "",
    "## Output B",
    "```",
    outputB.slice(0, 4000),
    outputB.length > 4000 ? "\n... (truncated)" : "",
    "```",
    "",
  ];

  if (rubric) {
    parts.push("## Rubric", rubric, "");
  }

  parts.push(
    "Please compare Output A and Output B against the plan.",
    "Respond with a JSON object containing: preference ('A', 'B', or 'tie'), reasoning, scoreA, and scoreB."
  );

  return parts.join("\n");
}

function parseEvaluationInput(message: string): { plan: Plan; output: string; threshold?: number } {
  // Try to parse as JSON first
  try {
    const parsed = JSON.parse(message);
    if (parsed.plan && parsed.output) {
      return {
        plan: parsed.plan as Plan,
        output: String(parsed.output),
        threshold: typeof parsed.threshold === "number" ? parsed.threshold : undefined,
      };
    }
  } catch {
    // Not JSON, parse text format
  }

  // Parse text format: "Plan: ... Output: ..."
  const planMatch = message.match(/Plan:\s*([\s\S]*?)(?=Output:|$)/i);
  const outputMatch = message.match(/Output:\s*([\s\S]*?)$/i);

  const plan: Plan = {
    goal: planMatch ? planMatch[1].trim().slice(0, 200) : "Evaluate the output",
    steps: [],
    acceptance: ["Output addresses the goal"],
    risks: ["Evaluation may be subjective"],
    revision: 1,
  };

  const output = outputMatch ? outputMatch[1].trim() : message;

  return { plan, output };
}
