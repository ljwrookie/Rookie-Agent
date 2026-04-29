import { describe, it, expect } from "vitest";
import {
  DefaultRewardFunction,
  CodeRewardFunction,
  ConversationRewardFunction,
  rewardRegistry,
} from "../src/rewards/functions.js";
import type { Trajectory, TrajectoryStep } from "../src/types.js";

function createMockTrajectory(): Trajectory {
  return {
    id: "test-1",
    sessionId: "session-1",
    task: "test task",
    steps: [],
    totalReward: 0,
    length: 0,
    startTime: new Date(),
  };
}

function createMockStep(overrides: Partial<TrajectoryStep> = {}): TrajectoryStep {
  return {
    id: "step-1",
    observation: "test",
    action: {
      type: "tool",
      content: "test action",
    },
    reward: 0,
    done: false,
    timestamp: new Date(),
    ...overrides,
  };
}

describe("DefaultRewardFunction", () => {
  const rewardFn = new DefaultRewardFunction();

  it("should calculate tool use reward", () => {
    const trajectory = createMockTrajectory();
    const step = createMockStep({
      action: {
        type: "tool",
        content: "test",
        toolCalls: [
          { name: "read_file", arguments: {}, result: "content" },
        ],
      },
    });

    const reward = rewardFn.calculateStepReward(step, trajectory);
    expect(reward).toBeGreaterThan(0);
  });

  it("should calculate final reward for success", () => {
    const trajectory = createMockTrajectory();
    trajectory.success = true;
    trajectory.length = 10;

    const reward = rewardFn.calculateFinalReward(trajectory);
    expect(reward).toBeGreaterThan(0);
  });

  it("should provide reward breakdown", () => {
    const trajectory = createMockTrajectory();
    const step = createMockStep({
      action: {
        type: "tool",
        content: "test",
        toolCalls: [{ name: "test", arguments: {} }],
      },
    });

    const breakdown = rewardFn.getBreakdown(step, trajectory);
    expect(breakdown.total).toBeDefined();
    expect(breakdown.components).toBeDefined();
    expect(breakdown.explanations).toBeDefined();
  });
});

describe("CodeRewardFunction", () => {
  const rewardFn = new CodeRewardFunction();

  it("should reward testing behavior", () => {
    const trajectory = createMockTrajectory();
    const step = createMockStep({
      action: {
        type: "code",
        content: "Let me add tests for this function",
      },
    });

    const reward = rewardFn.calculateStepReward(step, trajectory);
    expect(reward).toBeGreaterThan(0);
  });

  it("should reward error handling", () => {
    const trajectory = createMockTrajectory();
    const step = createMockStep({
      action: {
        type: "code",
        content: "Add error handling with try-catch",
      },
    });

    const reward = rewardFn.calculateStepReward(step, trajectory);
    expect(reward).toBeGreaterThan(0);
  });

  it("should give higher reward for successful code tasks with tests", () => {
    const trajectory = createMockTrajectory();
    trajectory.success = true;
    trajectory.length = 15;
    trajectory.steps = [
      createMockStep({
        action: {
          type: "tool",
          content: "run tests",
          toolCalls: [{ name: "run_test", arguments: {}, result: "passed" }],
        },
      }),
    ];

    const reward = rewardFn.calculateFinalReward(trajectory);
    expect(reward).toBeGreaterThan(10); // Base success reward
  });
});

describe("ConversationRewardFunction", () => {
  const rewardFn = new ConversationRewardFunction();

  it("should reward helpful responses", () => {
    const trajectory = createMockTrajectory();
    const step = createMockStep({
      action: {
        type: "message",
        content: "Here is how you can solve this problem",
      },
    });

    const reward = rewardFn.calculateStepReward(step, trajectory);
    expect(reward).toBeGreaterThan(0);
  });

  it("should reward explanations", () => {
    const trajectory = createMockTrajectory();
    const step = createMockStep({
      action: {
        type: "message",
        content: "The reason is because...",
      },
    });

    const reward = rewardFn.calculateStepReward(step, trajectory);
    expect(reward).toBeGreaterThan(0);
  });

  it("should reward questions", () => {
    const trajectory = createMockTrajectory();
    const step = createMockStep({
      action: {
        type: "message",
        content: "What would you like to do next?",
      },
    });

    const reward = rewardFn.calculateStepReward(step, trajectory);
    expect(reward).toBeGreaterThan(0);
  });
});

describe("RewardRegistry", () => {
  it("should have default functions registered", () => {
    const defaultFn = rewardRegistry.get("default");
    const codeFn = rewardRegistry.get("code");
    const conversationFn = rewardRegistry.get("conversation");

    expect(defaultFn).toBeDefined();
    expect(codeFn).toBeDefined();
    expect(conversationFn).toBeDefined();
  });

  it("should create function from config", () => {
    const fn = rewardRegistry.createFromConfig({
      name: "code",
      weights: {
        completion: 1.5,
        correctness: 1.0,
        efficiency: 0.5,
        toolUse: 0.3,
        codeQuality: 1.0,
        userSatisfaction: 0.5,
      },
    });

    expect(fn.name).toBe("code");
  });
});
