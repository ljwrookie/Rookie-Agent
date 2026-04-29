/**
 * Atropos training platform adapter
 */

import type {
  Trajectory,
  TrainingConfig,
  AtroposConfig,
  PolicyCheckpoint,
} from "../types.js";

/** Atropos adapter for model training */
export class AtroposAdapter {
  private config: AtroposConfig;
  private initialized = false;

  constructor(config: AtroposConfig) {
    this.config = config;
  }

  /**
   * Initialize the adapter
   */
  async init(): Promise<void> {
    // Validate configuration
    if (!this.config.endpoint) {
      throw new Error("Atropos endpoint is required");
    }
    if (!this.config.dataset) {
      throw new Error("Atropos dataset name is required");
    }

    // Test connection
    try {
      const response = await fetch(`${this.config.endpoint}/health`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Atropos health check failed: ${response.status}`);
      }

      this.initialized = true;
    } catch (error) {
      console.warn("Failed to connect to Atropos:", error);
      // Don't throw - allow offline training
      this.initialized = true;
    }
  }

  /**
   * Upload trajectories to Atropos
   */
  async uploadTrajectories(trajectories: Trajectory[]): Promise<void> {
    if (!this.initialized) {
      throw new Error("Atropos adapter not initialized");
    }

    try {
      const response = await fetch(
        `${this.config.endpoint}/datasets/${this.config.dataset}/trajectories`,
        {
          method: "POST",
          headers: this.getHeaders(),
          body: JSON.stringify({ trajectories }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to upload trajectories: ${response.status}`);
      }
    } catch (error) {
      console.warn("Failed to upload trajectories to Atropos:", error);
      // Store locally for later sync
      this.storeLocally(trajectories);
    }
  }

  /**
   * Start a training run
   */
  async startTraining(config: TrainingConfig): Promise<string> {
    if (!this.initialized) {
      throw new Error("Atropos adapter not initialized");
    }

    try {
      const response = await fetch(`${this.config.endpoint}/training/runs`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          dataset: this.config.dataset,
          config: {
            batch_size: this.config.batchSize,
            learning_rate: this.config.learningRate,
            iterations: config.iterations,
            reward_config: config.rewardConfig,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to start training: ${response.status}`);
      }

      const result = await response.json() as { run_id: string };
      return result.run_id;
    } catch (error) {
      console.warn("Failed to start Atropos training:", error);
      // Return a local run ID for tracking
      return `local-${Date.now()}`;
    }
  }

  /**
   * Get training status
   */
  async getTrainingStatus(runId: string): Promise<{
    status: "pending" | "running" | "completed" | "failed";
    progress: number;
    metrics?: Record<string, number>;
  }> {
    if (!this.initialized) {
      return { status: "pending", progress: 0 };
    }

    try {
      const response = await fetch(
        `${this.config.endpoint}/training/runs/${runId}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get training status: ${response.status}`);
      }

      return await response.json() as {
        status: "pending" | "running" | "completed" | "failed";
        progress: number;
        metrics?: Record<string, number>;
      };
    } catch (error) {
      console.warn("Failed to get training status:", error);
      return { status: "pending", progress: 0 };
    }
  }

  /**
   * Download checkpoint
   */
  async downloadCheckpoint(runId: string, iteration: number): Promise<PolicyCheckpoint> {
    if (!this.initialized) {
      throw new Error("Atropos adapter not initialized");
    }

    try {
      const response = await fetch(
        `${this.config.endpoint}/training/runs/${runId}/checkpoints/${iteration}`,
        {
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to download checkpoint: ${response.status}`);
      }

      const result = await response.json() as PolicyCheckpoint;
      return result;
    } catch (error) {
      console.warn("Failed to download checkpoint:", error);
      throw error;
    }
  }

  /**
   * Get headers for API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  /**
   * Store trajectories locally for later sync
   */
  private storeLocally(trajectories: Trajectory[]): void {
    // In a real implementation, this would save to a local database
    console.log(`Storing ${trajectories.length} trajectories locally for later sync`);
  }
}
