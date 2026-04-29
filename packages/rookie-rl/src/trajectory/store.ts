/**
 * Trajectory storage and management
 */

import { randomUUID } from "crypto";
import type { Trajectory, TrajectoryStep, TrajectoryMetadata } from "../types.js";

/** Trajectory store options */
export interface TrajectoryStoreOptions {
  /** Max trajectories to keep in memory */
  maxInMemory?: number;
  /** Persist to disk */
  persist?: boolean;
  /** Storage path */
  storagePath?: string;
}

/** Trajectory store */
export class TrajectoryStore {
  private trajectories: Map<string, Trajectory> = new Map();
  private options: Required<TrajectoryStoreOptions>;

  constructor(options: TrajectoryStoreOptions = {}) {
    this.options = {
      maxInMemory: options.maxInMemory ?? 1000,
      persist: options.persist ?? false,
      storagePath: options.storagePath ?? "./trajectories",
    };
  }

  /**
   * Create a new trajectory
   */
  createTrajectory(sessionId: string, task: string, metadata?: TrajectoryMetadata): Trajectory {
    const trajectory: Trajectory = {
      id: randomUUID(),
      sessionId,
      task,
      steps: [],
      totalReward: 0,
      length: 0,
      startTime: new Date(),
      metadata,
    };

    this.trajectories.set(trajectory.id, trajectory);
    this.enforceMaxSize();

    return trajectory;
  }

  /**
   * Get a trajectory by ID
   */
  getTrajectory(id: string): Trajectory | undefined {
    return this.trajectories.get(id);
  }

  /**
   * Add a step to a trajectory
   */
  addStep(trajectoryId: string, step: Omit<TrajectoryStep, "id" | "timestamp">): TrajectoryStep {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory) {
      throw new Error(`Trajectory not found: ${trajectoryId}`);
    }

    const fullStep: TrajectoryStep = {
      ...step,
      id: randomUUID(),
      timestamp: new Date(),
    };

    trajectory.steps.push(fullStep);
    trajectory.totalReward += step.reward;
    trajectory.length = trajectory.steps.length;

    if (step.done) {
      trajectory.endTime = new Date();
    }

    return fullStep;
  }

  /**
   * Complete a trajectory
   */
  completeTrajectory(
    trajectoryId: string,
    success?: boolean,
    finalReward?: number
  ): Trajectory {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory) {
      throw new Error(`Trajectory not found: ${trajectoryId}`);
    }

    trajectory.endTime = new Date();
    trajectory.success = success;

    if (finalReward !== undefined) {
      trajectory.totalReward += finalReward;
    }

    return trajectory;
  }

  /**
   * Get all trajectories
   */
  getAllTrajectories(): Trajectory[] {
    return Array.from(this.trajectories.values());
  }

  /**
   * Get trajectories for a session
   */
  getTrajectoriesBySession(sessionId: string): Trajectory[] {
    return this.getAllTrajectories().filter((t) => t.sessionId === sessionId);
  }

  /**
   * Get trajectories by task
   */
  getTrajectoriesByTask(task: string): Trajectory[] {
    return this.getAllTrajectories().filter((t) => t.task === task);
  }

  /**
   * Get successful trajectories
   */
  getSuccessfulTrajectories(): Trajectory[] {
    return this.getAllTrajectories().filter((t) => t.success === true);
  }

  /**
   * Get recent trajectories
   */
  getRecentTrajectories(limit: number = 10): Trajectory[] {
    return this.getAllTrajectories()
      .sort((a, b) => (b.startTime.getTime() - a.startTime.getTime()))
      .slice(0, limit);
  }

  /**
   * Delete a trajectory
   */
  deleteTrajectory(id: string): boolean {
    return this.trajectories.delete(id);
  }

  /**
   * Clear all trajectories
   */
  clear(): void {
    this.trajectories.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    completed: number;
    successful: number;
    averageReward: number;
    averageLength: number;
  } {
    const all = this.getAllTrajectories();
    const completed = all.filter((t) => t.endTime !== undefined);
    const successful = all.filter((t) => t.success === true);

    const totalReward = all.reduce((sum, t) => sum + t.totalReward, 0);
    const totalLength = all.reduce((sum, t) => sum + t.length, 0);

    return {
      total: all.length,
      completed: completed.length,
      successful: successful.length,
      averageReward: all.length > 0 ? totalReward / all.length : 0,
      averageLength: all.length > 0 ? totalLength / all.length : 0,
    };
  }

  /**
   * Export trajectories to JSON
   */
  exportToJSON(): string {
    return JSON.stringify(this.getAllTrajectories(), null, 2);
  }

  /**
   * Import trajectories from JSON
   */
  importFromJSON(json: string): void {
    const trajectories: Trajectory[] = JSON.parse(json);
    for (const trajectory of trajectories) {
      // Restore dates
      trajectory.startTime = new Date(trajectory.startTime);
      if (trajectory.endTime) {
        trajectory.endTime = new Date(trajectory.endTime);
      }
      for (const step of trajectory.steps) {
        step.timestamp = new Date(step.timestamp);
      }
      this.trajectories.set(trajectory.id, trajectory);
    }
    this.enforceMaxSize();
  }

  /**
   * Enforce max in-memory size
   */
  private enforceMaxSize(): void {
    if (this.trajectories.size <= this.options.maxInMemory) {
      return;
    }

    // Remove oldest trajectories
    const sorted = this.getAllTrajectories().sort(
      (a, b) => a.startTime.getTime() - b.startTime.getTime()
    );

    const toRemove = sorted.slice(0, this.trajectories.size - this.options.maxInMemory);
    for (const trajectory of toRemove) {
      this.trajectories.delete(trajectory.id);
    }
  }
}

/** Global trajectory store instance */
let globalStore: TrajectoryStore | null = null;

/** Get or create global trajectory store */
export function getTrajectoryStore(options?: TrajectoryStoreOptions): TrajectoryStore {
  if (!globalStore) {
    globalStore = new TrajectoryStore(options);
  }
  return globalStore;
}
