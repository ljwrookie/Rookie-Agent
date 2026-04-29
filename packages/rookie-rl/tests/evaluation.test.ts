import { describe, it, expect } from "vitest";
import { PolicyEvaluator, formatEvaluationResult } from "../src/evaluation/evaluator.js";
import { DefaultRewardFunction } from "../src/rewards/functions.js";
import type { Trajectory } from "../src/types.js";

function createMockTrajectory(overrides: Partial<Trajectory> = {}): Trajectory {
  return {
    id: `traj-${Math.random().toString(36).slice(2)}`,
    sessionId: "session-1",
    task: overrides.task || "test-task",
    steps: [],
    totalReward: overrides.totalReward ?? 10,
    length: overrides.length ?? 5,
    success: overrides.success ?? true,
    startTime: new Date(),
    ...overrides,
  };
}

describe("PolicyEvaluator", () => {
  const rewardFn = new DefaultRewardFunction();
  const evaluator = new PolicyEvaluator(rewardFn);

  it("should evaluate empty trajectories", () => {
    const result = evaluator.evaluate([]);

    expect(result.episodeCount).toBe(0);
    expect(result.averageReward).toBe(0);
    expect(result.successRate).toBe(0);
  });

  it("should calculate average metrics", () => {
    const trajectories = [
      createMockTrajectory({ totalReward: 10, length: 5, success: true }),
      createMockTrajectory({ totalReward: 20, length: 10, success: true }),
      createMockTrajectory({ totalReward: 0, length: 3, success: false }),
    ];

    const result = evaluator.evaluate(trajectories);

    expect(result.episodeCount).toBe(3);
    expect(result.averageReward).toBe(10);
    expect(result.averageLength).toBe(6);
    expect(result.successRate).toBe(2 / 3);
  });

  it("should provide per-task breakdown", () => {
    const trajectories = [
      createMockTrajectory({ task: "task-a", totalReward: 10, success: true }),
      createMockTrajectory({ task: "task-a", totalReward: 20, success: true }),
      createMockTrajectory({ task: "task-b", totalReward: 5, success: false }),
    ];

    const result = evaluator.evaluate(trajectories);

    expect(result.taskBreakdown).toHaveLength(2);

    const taskA = result.taskBreakdown.find((t) => t.task === "task-a");
    expect(taskA).toBeDefined();
    expect(taskA?.count).toBe(2);
    expect(taskA?.averageReward).toBe(15);
    expect(taskA?.successRate).toBe(1);

    const taskB = result.taskBreakdown.find((t) => t.task === "task-b");
    expect(taskB).toBeDefined();
    expect(taskB?.successRate).toBe(0);
  });

  it("should compare two sets of trajectories", () => {
    const baseline = [
      createMockTrajectory({ totalReward: 10, success: true }),
      createMockTrajectory({ totalReward: 10, success: true }),
    ];

    const candidate = [
      createMockTrajectory({ totalReward: 15, success: true }),
      createMockTrajectory({ totalReward: 15, success: true }),
    ];

    const comparison = evaluator.compare(baseline, candidate);

    expect(comparison.baseline.averageReward).toBe(10);
    expect(comparison.candidate.averageReward).toBe(15);
    expect(comparison.improvement.reward).toBe(0.5); // 50% improvement
  });

  it("should run statistical test", () => {
    const baseline = Array(10)
      .fill(null)
      .map(() => createMockTrajectory({ totalReward: 10, success: true }));

    const candidate = Array(10)
      .fill(null)
      .map(() => createMockTrajectory({ totalReward: 15, success: true }));

    const test = evaluator.statisticalTest(baseline, candidate);

    expect(test.reward.pValue).toBeLessThan(1);
    expect(test.reward.significant).toBeDefined();
    expect(test.success.pValue).toBeDefined();
  });
});

describe("formatEvaluationResult", () => {
  it("should format evaluation result as string", () => {
    const result = {
      id: "eval-1",
      episodeCount: 10,
      averageReward: 15.5,
      successRate: 0.8,
      averageLength: 7.5,
      taskBreakdown: [
        { task: "task-a", count: 5, averageReward: 20, successRate: 1.0 },
        { task: "task-b", count: 5, averageReward: 11, successRate: 0.6 },
      ],
      timestamp: new Date(),
    };

    const formatted = formatEvaluationResult(result);

    expect(formatted).toContain("Evaluation Results");
    expect(formatted).toContain("Episodes: 10");
    expect(formatted).toContain("Average Reward: 15.500");
    expect(formatted).toContain("Success Rate: 80.0%");
    expect(formatted).toContain("task-a");
    expect(formatted).toContain("task-b");
  });
});
