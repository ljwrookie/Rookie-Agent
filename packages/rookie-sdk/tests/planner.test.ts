import { describe, it, expect } from "vitest";
import { makePlan, renderPlanMarkdown } from "../src/agent/planner.js";

describe("makePlan", () => {
  it("produces a plan with revision=1 and non-empty steps", () => {
    const plan = makePlan("Fix the login button so it submits the form");
    expect(plan.revision).toBe(1);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0].id).toBe(1);
    expect(plan.goal).toBe("Fix the login button so it submits the form");
    expect(plan.acceptance.length).toBeGreaterThan(0);
    expect(plan.risks.length).toBeGreaterThan(0);
  });

  it("splits multi-sentence tasks into steps", () => {
    const plan = makePlan("Add a /logout route. Clear the cookie. Redirect home");
    expect(plan.steps.length).toBe(3);
    expect(plan.steps[0].title).toMatch(/logout route/i);
    expect(plan.steps[2].title).toMatch(/redirect home/i);
  });

  it("increments revision and records critique when revising", () => {
    const v1 = makePlan("Ship feature");
    const v2 = makePlan("Ship feature", { previous: v1, critique: "coverage too low" });
    expect(v2.revision).toBe(v1.revision + 1);
    expect(v2.notes).toContain("coverage too low");
  });

  it("honours an injected custom planner", () => {
    const plan = makePlan("whatever", {
      planner: (task) => ({
        goal: task,
        steps: [{ id: 1, title: "custom" }],
        acceptance: ["a"],
        risks: ["r"],
        revision: 9,
      }),
    });
    expect(plan.revision).toBe(9);
    expect(plan.steps[0].title).toBe("custom");
  });

  it("renders plan to markdown with headings and steps", () => {
    const plan = makePlan("Do A. Do B");
    const md = renderPlanMarkdown(plan);
    expect(md).toMatch(/^# Plan \(rev 1\)/);
    expect(md).toContain("## Steps");
    expect(md).toContain("1. Do A");
    expect(md).toContain("## Acceptance");
    expect(md).toContain("## Risks");
  });
});
