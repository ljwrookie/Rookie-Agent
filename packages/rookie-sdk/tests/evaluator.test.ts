import { describe, it, expect } from "vitest";
import { evaluate, RUBRIC_AXES } from "../src/agent/evaluator.js";
import { makePlan } from "../src/agent/planner.js";

const PLAN = makePlan("Add feature X and document it in the README");

describe("evaluate", () => {
  it("scores all four rubric axes", () => {
    const result = evaluate({ plan: PLAN, output: "# Feature X\nImplemented in src/x.ts.\nDocumented in README." });
    expect(result.scores).toHaveLength(RUBRIC_AXES.length);
    const axes = result.scores.map((s) => s.axis).sort();
    expect(axes).toEqual([...RUBRIC_AXES].sort());
  });

  it("marks empty output as failing with retry hint", () => {
    const result = evaluate({ plan: PLAN, output: "" });
    expect(result.pass).toBe(false);
    expect(result.overall).toBeLessThan(0.7);
    expect(result.retryHint).toBeTruthy();
    const correctness = result.scores.find((s) => s.axis === "correctness")!;
    expect(correctness.score).toBe(0);
  });

  it("passes when output covers the plan and has structure", () => {
    const output = [
      "# Add feature X and document it in the README",
      "",
      "## Add feature X and document it in the README",
      "Implementation lives in src/x.ts with tests in tests/x.test.ts.",
      "README section lists usage examples.",
    ].join("\n");
    const result = evaluate({ plan: PLAN, output, threshold: 0.6 });
    expect(result.pass).toBe(true);
    expect(result.overall).toBeGreaterThanOrEqual(0.6);
    expect(result.retryHint).toBeUndefined();
  });

  it("penalises TODO/FIXME markers in correctness", () => {
    const output = "# Heading\n\nTODO: implement later\n";
    const result = evaluate({ plan: PLAN, output });
    const correctness = result.scores.find((s) => s.axis === "correctness")!;
    expect(correctness.reason).toMatch(/TODO|FIXME|placeholder/);
  });

  it("honours a custom scorer", () => {
    const result = evaluate({
      plan: PLAN,
      output: "anything",
      scorer: (axis) => ({ axis, score: 1, reason: "forced pass" }),
    });
    expect(result.pass).toBe(true);
    expect(result.overall).toBe(1);
  });

  it("respects configured threshold", () => {
    // Same output, threshold 0.95 should fail; threshold 0.1 should pass.
    const output = "# Heading\n\nSome content that only loosely matches.";
    const high = evaluate({ plan: PLAN, output, threshold: 0.95 });
    const low = evaluate({ plan: PLAN, output, threshold: 0.1 });
    expect(high.pass).toBe(false);
    expect(low.pass).toBe(true);
  });
});
