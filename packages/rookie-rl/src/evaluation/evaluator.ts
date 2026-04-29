/**
 * Policy evaluation for RL training
 */

import type {
  Trajectory,
  EvaluationResult,
  TaskEvaluation,
} from "../types.js";
import type { RewardFunction } from "../rewards/functions.js";

/** Evaluation options */
export interface EvaluationOptions {
  /** Number of episodes to evaluate */
  numEpisodes: number;
  /** Tasks to evaluate on */
  tasks?: string[];
  /** Whether to use greedy policy */
  greedy?: boolean;
  /** Random seed */
  seed?: number;
}

/** Policy evaluator */
export class PolicyEvaluator {
  private rewardFunction: RewardFunction;

  constructor(rewardFunction: RewardFunction) {
    this.rewardFunction = rewardFunction;
  }

  /**
   * Evaluate a policy on a set of trajectories
   */
  evaluate(trajectories: Trajectory[]): EvaluationResult {
    const id = `eval-${Date.now()}`;
    const episodeCount = trajectories.length;

    if (episodeCount === 0) {
      return {
        id,
        episodeCount: 0,
        averageReward: 0,
        successRate: 0,
        averageLength: 0,
        taskBreakdown: [],
        timestamp: new Date(),
      };
    }

    // Calculate overall metrics
    const totalReward = trajectories.reduce((sum, t) => sum + t.totalReward, 0);
    const totalLength = trajectories.reduce((sum, t) => sum + t.length, 0);
    const successful = trajectories.filter((t) => t.success).length;

    // Calculate per-task metrics
    const taskGroups = this.groupByTask(trajectories);
    const taskBreakdown: TaskEvaluation[] = Object.entries(taskGroups).map(
      ([task, taskTrajectories]) => ({
        task,
        count: taskTrajectories.length,
        averageReward:
          taskTrajectories.reduce((sum, t) => sum + t.totalReward, 0) /
          taskTrajectories.length,
        successRate:
          taskTrajectories.filter((t) => t.success).length / taskTrajectories.length,
      })
    );

    return {
      id,
      episodeCount,
      averageReward: totalReward / episodeCount,
      successRate: successful / episodeCount,
      averageLength: totalLength / episodeCount,
      taskBreakdown,
      timestamp: new Date(),
    };
  }

  /**
   * Evaluate and compare two sets of trajectories
   */
  compare(
    baseline: Trajectory[],
    candidate: Trajectory[]
  ): {
    baseline: EvaluationResult;
    candidate: EvaluationResult;
    improvement: {
      reward: number;
      successRate: number;
      length: number;
    };
  } {
    const baselineResult = this.evaluate(baseline);
    const candidateResult = this.evaluate(candidate);

    const improvement = {
      reward:
        baselineResult.averageReward !== 0
          ? (candidateResult.averageReward - baselineResult.averageReward) /
            Math.abs(baselineResult.averageReward)
          : 0,
      successRate: candidateResult.successRate - baselineResult.successRate,
      length:
        baselineResult.averageLength !== 0
          ? (baselineResult.averageLength - candidateResult.averageLength) /
            baselineResult.averageLength
          : 0,
    };

    return {
      baseline: baselineResult,
      candidate: candidateResult,
      improvement,
    };
  }

  /**
   * Run statistical significance test
   */
  statisticalTest(
    baseline: Trajectory[],
    candidate: Trajectory[]
  ): {
    reward: { pValue: number; significant: boolean };
    success: { pValue: number; significant: boolean };
  } {
    // Simple t-test approximation
    const baselineRewards = baseline.map((t) => t.totalReward);
    const candidateRewards = candidate.map((t) => t.totalReward);

    const baselineMean = this.mean(baselineRewards);
    const candidateMean = this.mean(candidateRewards);
    const baselineStd = this.std(baselineRewards);
    const candidateStd = this.std(candidateRewards);

    // Pooled standard error
    const n1 = baseline.length;
    const n2 = candidate.length;
    const se = Math.sqrt(
      (baselineStd ** 2) / n1 + (candidateStd ** 2) / n2
    );

    // T-statistic
    const t = (candidateMean - baselineMean) / se;

    // Approximate p-value (two-tailed)
    const pValue = this.approximatePValue(t, n1 + n2 - 2);

    // Success rate test (chi-square approximation)
    const baselineSuccesses = baseline.filter((t) => t.success).length;
    const candidateSuccesses = candidate.filter((t) => t.success).length;

    const p1 = baselineSuccesses / n1;
    const p2 = candidateSuccesses / n2;
    const p = (baselineSuccesses + candidateSuccesses) / (n1 + n2);

    const seSuccess = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    const z = (p2 - p1) / seSuccess;
    const pValueSuccess = this.approximatePValue(z, Infinity);

    return {
      reward: {
        pValue,
        significant: pValue < 0.05,
      },
      success: {
        pValue: pValueSuccess,
        significant: pValueSuccess < 0.05,
      },
    };
  }

  /**
   * Group trajectories by task
   */
  private groupByTask(trajectories: Trajectory[]): Record<string, Trajectory[]> {
    const groups: Record<string, Trajectory[]> = {};

    for (const trajectory of trajectories) {
      const task = trajectory.task || "unknown";
      if (!groups[task]) {
        groups[task] = [];
      }
      groups[task].push(trajectory);
    }

    return groups;
  }

  /**
   * Calculate mean
   */
  private mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate standard deviation
   */
  private std(values: number[]): number {
    if (values.length <= 1) return 0;
    const m = this.mean(values);
    const variance =
      values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  /**
   * Approximate p-value from t-statistic
   */
  private approximatePValue(t: number, df: number): number {
    // Simplified approximation using normal distribution for large df
    if (df > 30) {
      return 2 * (1 - this.normalCDF(Math.abs(t)));
    }
    // For small df, use a rough approximation
    return 2 * (1 - this.normalCDF(Math.abs(t) * Math.sqrt(df / (df - 2))));
  }

  /**
   * Standard normal CDF approximation
   */
  private normalCDF(x: number): number {
    // Abramowitz and Stegun approximation
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);

    const t = 1 / (1 + p * x);
    const y =
      1 -
      (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return 0.5 * (1 + sign * y);
  }
}

/** Evaluation summary formatter */
export function formatEvaluationResult(result: EvaluationResult): string {
  const lines = [
    `Evaluation Results (${result.id})`,
    `==================`,
    `Episodes: ${result.episodeCount}`,
    `Average Reward: ${result.averageReward.toFixed(3)}`,
    `Success Rate: ${(result.successRate * 100).toFixed(1)}%`,
    `Average Length: ${result.averageLength.toFixed(1)}`,
    ``,
    `Per-Task Breakdown:`,
    ...result.taskBreakdown.map(
      (t) =>
        `  ${t.task}: ${t.count} episodes, ` +
        `avg reward ${t.averageReward.toFixed(3)}, ` +
        `success ${(t.successRate * 100).toFixed(1)}%`
    ),
  ];

  return lines.join("\n");
}
