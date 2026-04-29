/**
 * Rookie Agent RL (Reinforcement Learning) module
 */

// Types
export * from "./types.js";

// Trajectory
export {
  TrajectoryStore,
  getTrajectoryStore,
  type TrajectoryStoreOptions,
} from "./trajectory/store.js";

// Rewards
export {
  DefaultRewardFunction,
  CodeRewardFunction,
  ConversationRewardFunction,
  RewardFunctionRegistry,
  rewardRegistry,
  type RewardFunction,
} from "./rewards/functions.js";

// Evaluation
export {
  PolicyEvaluator,
  formatEvaluationResult,
  type EvaluationOptions,
} from "./evaluation/evaluator.js";

// Adapters
export { WandbAdapter } from "./adapters/wandb.js";
export { AtroposAdapter } from "./adapters/atropos.js";

// Main RL trainer
import { TrajectoryStore } from "./trajectory/store.js";
import { PolicyEvaluator } from "./evaluation/evaluator.js";
import { WandbAdapter } from "./adapters/wandb.js";
import { AtroposAdapter } from "./adapters/atropos.js";
import { RewardFunctionRegistry } from "./rewards/functions.js";
import type {
  Trajectory,
  TrainingConfig,
  EvaluationResult,
  PolicyCheckpoint,
  WandbConfig,
  AtroposConfig,
  RewardConfig,
} from "./types.js";

/** RL Trainer */
export class RLTrainer {
  private trajectoryStore: TrajectoryStore;
  private rewardRegistry: RewardFunctionRegistry;
  private wandb?: WandbAdapter;
  private atropos?: AtroposAdapter;
  private config?: TrainingConfig;

  constructor(options?: { trajectoryStore?: TrajectoryStore }) {
    this.trajectoryStore = options?.trajectoryStore ?? new TrajectoryStore();
    this.rewardRegistry = new RewardFunctionRegistry();
  }

  /**
   * Initialize training
   */
  async init(config: TrainingConfig): Promise<void> {
    this.config = config;

    // Initialize WandB if configured
    if (config.wandb) {
      this.wandb = new WandbAdapter(config.wandb);
      await this.wandb.init(config);
    }

    // Initialize Atropos if configured
    if (config.atropos) {
      this.atropos = new AtroposAdapter(config.atropos);
      await this.atropos.init();
    }
  }

  /**
   * Record a trajectory
   */
  recordTrajectory(trajectory: Trajectory): void {
    // Store in trajectory store
    // The trajectory should already have rewards calculated
  }

  /**
   * Run evaluation
   */
  async evaluate(trajectories?: Trajectory[]): Promise<EvaluationResult> {
    const evalTrajectories = trajectories ?? this.trajectoryStore.getAllTrajectories();
    
    if (!this.config) {
      throw new Error("Trainer not initialized");
    }

    const rewardFn = this.rewardRegistry.createFromConfig(this.config.rewardConfig);
    const evaluator = new PolicyEvaluator(rewardFn);
    
    return evaluator.evaluate(evalTrajectories);
  }

  /**
   * Log metrics to WandB
   */
  async logMetrics(metrics: Record<string, number | string>, step?: number): Promise<void> {
    await this.wandb?.logMetrics(metrics, step);
  }

  /**
   * Upload trajectories to Atropos
   */
  async uploadTrajectories(trajectories?: Trajectory[]): Promise<void> {
    const toUpload = trajectories ?? this.trajectoryStore.getAllTrajectories();
    await this.atropos?.uploadTrajectories(toUpload);
  }

  /**
   * Finish training
   */
  async finish(): Promise<void> {
    await this.wandb?.finish();
  }

  /**
   * Get trajectory store
   */
  getTrajectoryStore(): TrajectoryStore {
    return this.trajectoryStore;
  }

  /**
   * Get reward registry
   */
  getRewardRegistry(): RewardFunctionRegistry {
    return this.rewardRegistry;
  }
}

/** Create a new RL trainer */
export function createRLTrainer(config?: { trajectoryStore?: TrajectoryStore }): RLTrainer {
  return new RLTrainer(config);
}
