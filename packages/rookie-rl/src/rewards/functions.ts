/**
 * Reward functions for RL training
 */

import type {
  Trajectory,
  TrajectoryStep,
  RewardConfig,
  RewardBreakdown,
  RewardWeights,
} from "../types.js";

/** Base reward function interface */
export interface RewardFunction {
  /** Function name */
  name: string;
  /** Calculate reward for a step */
  calculateStepReward(step: TrajectoryStep, trajectory: Trajectory): number;
  /** Calculate final reward for a trajectory */
  calculateFinalReward(trajectory: Trajectory): number;
  /** Get reward breakdown */
  getBreakdown(step: TrajectoryStep, trajectory: Trajectory): RewardBreakdown;
}

/** Default reward function with configurable weights */
export class DefaultRewardFunction implements RewardFunction {
  name = "default";
  private weights: RewardWeights;

  constructor(weights?: Partial<RewardWeights>) {
    this.weights = {
      completion: 1.0,
      correctness: 1.0,
      efficiency: 0.5,
      toolUse: 0.3,
      codeQuality: 0.4,
      userSatisfaction: 0.5,
      ...weights,
    };
  }

  calculateStepReward(step: TrajectoryStep, trajectory: Trajectory): number {
    let reward = 0;

    // Tool use reward
    if (step.action.toolCalls && step.action.toolCalls.length > 0) {
      const toolReward = this.calculateToolUseReward(step.action.toolCalls);
      reward += toolReward * this.weights.toolUse;
    }

    return reward;
  }

  calculateFinalReward(trajectory: Trajectory): number {
    let reward = 0;

    // Completion reward
    if (trajectory.success) {
      reward += 10 * this.weights.completion;
    } else if (trajectory.endTime) {
      // Partial completion
      reward += 2 * this.weights.completion;
    }

    // Efficiency reward (shorter is better, but not too short)
    const optimalLength = 10; // Assume optimal is around 10 steps
    const efficiency = Math.exp(-Math.abs(trajectory.length - optimalLength) / optimalLength);
    reward += efficiency * 5 * this.weights.efficiency;

    return reward;
  }

  getBreakdown(step: TrajectoryStep, trajectory: Trajectory): RewardBreakdown {
    const components: Record<string, number> = {};
    const explanations: Record<string, string> = {};

    // Tool use
    if (step.action.toolCalls) {
      const toolReward = this.calculateToolUseReward(step.action.toolCalls);
      components.toolUse = toolReward * this.weights.toolUse;
      explanations.toolUse = `Used ${step.action.toolCalls.length} tools appropriately`;
    }

    // Calculate total
    const total = Object.values(components).reduce((sum, v) => sum + v, 0);

    return {
      total,
      components,
      explanations,
    };
  }

  private calculateToolUseReward(toolCalls: Array<{ name: string; result?: unknown }>): number {
    let reward = 0;

    for (const call of toolCalls) {
      // Reward successful tool calls
      if (call.result !== undefined && call.result !== null) {
        reward += 0.5;

        // Bonus for appropriate tool selection
        const appropriateTools = ["read", "search", "analyze", "test"];
        if (appropriateTools.some((t) => call.name.toLowerCase().includes(t))) {
          reward += 0.3;
        }
      }
    }

    return Math.min(reward, 2); // Cap at 2
  }
}

/** Code-specific reward function */
export class CodeRewardFunction implements RewardFunction {
  name = "code";
  private weights: RewardWeights;

  constructor(weights?: Partial<RewardWeights>) {
    this.weights = {
      completion: 1.0,
      correctness: 1.0,
      efficiency: 0.5,
      toolUse: 0.3,
      codeQuality: 1.0,
      userSatisfaction: 0.5,
      ...weights,
    };
  }

  calculateStepReward(step: TrajectoryStep, trajectory: Trajectory): number {
    let reward = 0;

    // Code quality indicators in the action
    const content = step.action.content.toLowerCase();

    // Good practices
    if (content.includes("test") || content.includes("verify")) {
      reward += 0.5 * this.weights.codeQuality;
    }
    if (content.includes("error handling") || content.includes("try")) {
      reward += 0.3 * this.weights.codeQuality;
    }
    if (content.includes("type") || content.includes("interface")) {
      reward += 0.2 * this.weights.codeQuality;
    }

    // Tool use for code tasks
    if (step.action.toolCalls) {
      for (const call of step.action.toolCalls) {
        if (call.name.includes("edit") || call.name.includes("write")) {
          reward += 0.3 * this.weights.toolUse;
        }
        if (call.name.includes("test") || call.name.includes("lint")) {
          reward += 0.5 * this.weights.toolUse;
        }
      }
    }

    return reward;
  }

  calculateFinalReward(trajectory: Trajectory): number {
    let reward = 0;

    // Success is crucial for code
    if (trajectory.success) {
      reward += 20 * this.weights.completion;

      // Bonus for tests passing
      const hasTests = trajectory.steps.some(
        (s) =>
          s.action.content.toLowerCase().includes("test") ||
          s.action.toolCalls?.some((t) => t.name.toLowerCase().includes("test"))
      );
      if (hasTests) {
        reward += 5 * this.weights.codeQuality;
      }
    }

    // Efficiency
    const optimalLength = 15;
    const efficiency = Math.exp(-Math.abs(trajectory.length - optimalLength) / optimalLength);
    reward += efficiency * 5 * this.weights.efficiency;

    return reward;
  }

  getBreakdown(step: TrajectoryStep, trajectory: Trajectory): RewardBreakdown {
    const components: Record<string, number> = {};
    const explanations: Record<string, string> = {};

    const content = step.action.content.toLowerCase();

    if (content.includes("test")) {
      components.testing = 0.5 * this.weights.codeQuality;
      explanations.testing = "Included tests";
    }

    if (content.includes("error")) {
      components.errorHandling = 0.3 * this.weights.codeQuality;
      explanations.errorHandling = "Added error handling";
    }

    const total = Object.values(components).reduce((sum, v) => sum + v, 0);

    return {
      total,
      components,
      explanations,
    };
  }
}

/** Conversation reward function */
export class ConversationRewardFunction implements RewardFunction {
  name = "conversation";
  private weights: RewardWeights;

  constructor(weights?: Partial<RewardWeights>) {
    this.weights = {
      completion: 0.5,
      correctness: 1.0,
      efficiency: 0.3,
      toolUse: 0.2,
      codeQuality: 0,
      userSatisfaction: 1.0,
      ...weights,
    };
  }

  calculateStepReward(step: TrajectoryStep, trajectory: Trajectory): number {
    let reward = 0;

    // User satisfaction indicators
    const content = step.action.content.toLowerCase();

    // Helpful responses
    if (content.includes("here") || content.includes("let me")) {
      reward += 0.3 * this.weights.userSatisfaction;
    }

    // Clear explanations
    if (content.includes("because") || content.includes("reason")) {
      reward += 0.2 * this.weights.userSatisfaction;
    }

    // Follow-up questions show engagement
    if (content.includes("?")) {
      reward += 0.1 * this.weights.userSatisfaction;
    }

    return reward;
  }

  calculateFinalReward(trajectory: Trajectory): number {
    let reward = 0;

    // Conversation success
    if (trajectory.success) {
      reward += 5 * this.weights.completion;
    }

    // Natural conversation length
    const optimalLength = 8;
    const efficiency = Math.exp(-Math.abs(trajectory.length - optimalLength) / optimalLength);
    reward += efficiency * 3 * this.weights.efficiency;

    return reward;
  }

  getBreakdown(step: TrajectoryStep, trajectory: Trajectory): RewardBreakdown {
    const components: Record<string, number> = {};
    const explanations: Record<string, string> = {};

    const content = step.action.content.toLowerCase();

    if (content.includes("help")) {
      components.helpfulness = 0.3 * this.weights.userSatisfaction;
      explanations.helpfulness = "Offered help";
    }

    const total = Object.values(components).reduce((sum, v) => sum + v, 0);

    return {
      total,
      components,
      explanations,
    };
  }
}

/** Reward function registry */
export class RewardFunctionRegistry {
  private functions: Map<string, RewardFunction> = new Map();

  constructor() {
    // Register default functions
    this.register(new DefaultRewardFunction());
    this.register(new CodeRewardFunction());
    this.register(new ConversationRewardFunction());
  }

  register(fn: RewardFunction): void {
    this.functions.set(fn.name, fn);
  }

  get(name: string): RewardFunction | undefined {
    return this.functions.get(name);
  }

  getAll(): RewardFunction[] {
    return Array.from(this.functions.values());
  }

  createFromConfig(config: RewardConfig): RewardFunction {
    switch (config.name) {
      case "code":
        return new CodeRewardFunction(config.weights);
      case "conversation":
        return new ConversationRewardFunction(config.weights);
      default:
        return new DefaultRewardFunction(config.weights);
    }
  }
}

/** Global reward function registry */
export const rewardRegistry = new RewardFunctionRegistry();
