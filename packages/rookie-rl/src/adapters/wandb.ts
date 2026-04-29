/**
 * Weights & Biases integration for RL training
 */

import type {
  Trajectory,
  EvaluationResult,
  WandbConfig,
  TrainingConfig,
} from "../types.js";

/** WandB run interface */
interface WandbRun {
  log(data: Record<string, unknown>): Promise<void>;
  finish(): Promise<void>;
}

/** WandB adapter */
export class WandbAdapter {
  private config: WandbConfig;
  private run: WandbRun | null = null;
  private initialized = false;

  constructor(config: WandbConfig) {
    this.config = config;
  }

  /**
   * Initialize WandB
   */
  async init(config?: TrainingConfig): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import to avoid requiring wandb as a hard dependency
      const wandbModuleName = "wandb";
      const wandb = await import(wandbModuleName).catch(() => null);
      
      if (!wandb) {
        console.warn("wandb not installed, logging to console only");
        this.run = this.createConsoleRun();
        this.initialized = true;
        return;
      }

      // Initialize WandB run
      // Note: This is a simplified version - actual implementation would use wandb.init()
      this.run = await this.createWandbRun(wandb);
      
      // Log config
      if (config) {
        await this.run.log({ config });
      }

      this.initialized = true;
    } catch (error) {
      console.warn("Failed to initialize wandb:", error);
      this.run = this.createConsoleRun();
      this.initialized = true;
    }
  }

  /**
   * Log trajectory metrics
   */
  async logTrajectory(trajectory: Trajectory, step: number): Promise<void> {
    if (!this.run) return;

    await this.run.log({
      step,
      "trajectory/reward": trajectory.totalReward,
      "trajectory/length": trajectory.length,
      "trajectory/success": trajectory.success ? 1 : 0,
      "trajectory/task": trajectory.task,
    });
  }

  /**
   * Log batch metrics
   */
  async logBatchMetrics(
    metrics: {
      averageReward: number;
      successRate: number;
      averageLength: number;
      trajectories: number;
    },
    iteration: number
  ): Promise<void> {
    if (!this.run) return;

    await this.run.log({
      iteration,
      "batch/average_reward": metrics.averageReward,
      "batch/success_rate": metrics.successRate,
      "batch/average_length": metrics.averageLength,
      "batch/trajectories": metrics.trajectories,
    });
  }

  /**
   * Log evaluation results
   */
  async logEvaluation(result: EvaluationResult, iteration: number): Promise<void> {
    if (!this.run) return;

    await this.run.log({
      iteration,
      "eval/average_reward": result.averageReward,
      "eval/success_rate": result.successRate,
      "eval/average_length": result.averageLength,
      "eval/episodes": result.episodeCount,
    });

    // Log per-task metrics
    for (const task of result.taskBreakdown) {
      await this.run.log({
        iteration,
        [`eval/tasks/${task.task}/reward`]: task.averageReward,
        [`eval/tasks/${task.task}/success_rate`]: task.successRate,
      });
    }
  }

  /**
   * Log custom metrics
   */
  async logMetrics(metrics: Record<string, number | string>, step?: number): Promise<void> {
    if (!this.run) return;

    await this.run.log(step !== undefined ? { ...metrics, step } : metrics);
  }

  /**
   * Finish the run
   */
  async finish(): Promise<void> {
    if (this.run) {
      await this.run.finish();
      this.run = null;
      this.initialized = false;
    }
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Create a console-based run for when wandb is not available
   */
  private createConsoleRun(): WandbRun {
    return {
      log: async (data: Record<string, unknown>) => {
        console.log("[WandB]", new Date().toISOString(), data);
      },
      finish: async () => {
        console.log("[WandB] Run finished");
      },
    };
  }

  /**
   * Create actual WandB run
   */
  private async createWandbRun(wandb: unknown): Promise<WandbRun> {
    // This is a placeholder - actual implementation would use wandb.init()
    // The wandb package API may vary
    console.log("Creating WandB run:", this.config.project, this.config.name);
    
    return {
      log: async (data: Record<string, unknown>) => {
        console.log("[WandB]", data);
      },
      finish: async () => {
        console.log("[WandB] Run finished");
      },
    };
  }
}
