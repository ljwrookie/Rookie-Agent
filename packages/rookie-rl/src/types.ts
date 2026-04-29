/**
 * RL (Reinforcement Learning) types for Rookie Agent
 */

/** Trajectory step - single interaction */
export interface TrajectoryStep {
  /** Step ID */
  id: string;
  /** Observation/state */
  observation: string;
  /** Action taken */
  action: AgentAction;
  /** Reward received */
  reward: number;
  /** Next observation */
  nextObservation?: string;
  /** Whether episode ended */
  done: boolean;
  /** Additional info */
  info?: Record<string, unknown>;
  /** Timestamp */
  timestamp: Date;
}

/** Agent action */
export interface AgentAction {
  /** Action type */
  type: string;
  /** Action content */
  content: string;
  /** Tool calls if any */
  toolCalls?: ToolCall[];
  /** Raw LLM output */
  rawOutput?: string;
}

/** Tool call in action */
export interface ToolCall {
  /** Tool name */
  name: string;
  /** Arguments */
  arguments: Record<string, unknown>;
  /** Result */
  result?: unknown;
}

/** Complete trajectory (episode) */
export interface Trajectory {
  /** Trajectory ID */
  id: string;
  /** Session/agent ID */
  sessionId: string;
  /** List of steps */
  steps: TrajectoryStep[];
  /** Total reward */
  totalReward: number;
  /** Episode length */
  length: number;
  /** Whether episode was successful */
  success?: boolean;
  /** Task description */
  task: string;
  /** Start time */
  startTime: Date;
  /** End time */
  endTime?: Date;
  /** Metadata */
  metadata?: TrajectoryMetadata;
}

/** Trajectory metadata */
export interface TrajectoryMetadata {
  /** Model used */
  model?: string;
  /** Temperature */
  temperature?: number;
  /** Task category */
  category?: string;
  /** Difficulty level */
  difficulty?: "easy" | "medium" | "hard";
  /** Tags */
  tags?: string[];
}

/** Reward function configuration */
export interface RewardConfig {
  /** Reward function name */
  name: string;
  /** Weights for different components */
  weights: RewardWeights;
  /** Custom parameters */
  params?: Record<string, number>;
}

/** Reward component weights */
export interface RewardWeights {
  /** Task completion reward */
  completion: number;
  /** Correctness reward */
  correctness: number;
  /** Efficiency reward (fewer steps = better) */
  efficiency: number;
  /** Tool use appropriateness */
  toolUse: number;
  /** Code quality (for coding tasks) */
  codeQuality: number;
  /** User satisfaction */
  userSatisfaction: number;
}

/** Evaluated reward breakdown */
export interface RewardBreakdown {
  /** Total reward */
  total: number;
  /** Component rewards */
  components: Record<string, number>;
  /** Explanations */
  explanations: Record<string, string>;
}

/** Policy evaluation result */
export interface EvaluationResult {
  /** Evaluation ID */
  id: string;
  /** Number of episodes evaluated */
  episodeCount: number;
  /** Average reward */
  averageReward: number;
  /** Success rate */
  successRate: number;
  /** Average episode length */
  averageLength: number;
  /** Per-task breakdown */
  taskBreakdown: TaskEvaluation[];
  /** Timestamp */
  timestamp: Date;
}

/** Per-task evaluation */
export interface TaskEvaluation {
  /** Task name */
  task: string;
  /** Episode count */
  count: number;
  /** Average reward */
  averageReward: number;
  /** Success rate */
  successRate: number;
}

/** WandB configuration */
export interface WandbConfig {
  /** Project name */
  project: string;
  /** Run name */
  name?: string;
  /** Tags */
  tags?: string[];
  /** API key */
  apiKey?: string;
  /** Entity/team */
  entity?: string;
}

/** Atropos adapter configuration */
export interface AtroposConfig {
  /** Atropos endpoint */
  endpoint: string;
  /** API key */
  apiKey?: string;
  /** Dataset name */
  dataset: string;
  /** Batch size for training */
  batchSize: number;
  /** Learning rate */
  learningRate: number;
}

/** Training configuration */
export interface TrainingConfig {
  /** Number of training iterations */
  iterations: number;
  /** Trajectories per iteration */
  trajectoriesPerIteration: number;
  /** Reward configuration */
  rewardConfig: RewardConfig;
  /** WandB configuration */
  wandb?: WandbConfig;
  /** Atropos configuration */
  atropos?: AtroposConfig;
  /** Evaluation frequency */
  evalFrequency: number;
  /** Checkpoint frequency */
  checkpointFrequency: number;
}

/** Policy checkpoint */
export interface PolicyCheckpoint {
  /** Checkpoint ID */
  id: string;
  /** Iteration number */
  iteration: number;
  /** Model weights (path or data) */
  weights: string;
  /** Metrics at this checkpoint */
  metrics: Record<string, number>;
  /** Timestamp */
  timestamp: Date;
}

/** Human feedback for RLHF */
export interface HumanFeedback {
  /** Feedback ID */
  id: string;
  /** Trajectory ID */
  trajectoryId: string;
  /** Step indices being rated */
  stepIndices: number[];
  /** Rating (e.g., -1, 0, 1 or 1-5) */
  rating: number;
  /** Optional comment */
  comment?: string;
  /** Rater ID */
  raterId?: string;
  /** Timestamp */
  timestamp: Date;
}
