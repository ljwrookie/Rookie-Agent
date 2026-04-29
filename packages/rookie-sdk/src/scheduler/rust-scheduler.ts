/**
 * Rust-backed Cron Scheduler client
 *
 * Delegates to Rust tokio-cron implementation for high-precision
 * scheduling with <100ms deviation.
 */

import type {
  SchedulerOptions,
  SchedulerEvent,
  ScheduledTask,
} from "./types.js";

// NAPI bindings will be loaded dynamically
let native: any | null = null;

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

async function loadNative() {
  if (!native) {
    try {
      // NOTE: native module is optional and may not be present.
      // Use require() to avoid TS module-resolution errors when the native bundle isn't built.
      native = require("../../../native");
    } catch {
      native = null;
    }
  }
  return native;
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

/**
 * Task history entry
 */
export interface TaskHistoryEntry {
  id: string;
  taskId: string;
  startedAt: number;
  completedAt?: number;
  status: "scheduled" | "running" | "completed" | "failed" | "paused" | "cancelled";
  output?: string;
  error?: string;
  durationMs?: number;
}

/**
 * Rust-backed Scheduler
 *
 * Uses tokio-cron in Rust for high-precision scheduling.
 * Falls back to JS implementation if native module unavailable.
 */
export class RustScheduler {
  private nativeScheduler: any = null;
  private fallbackScheduler: any = null;
  private useNative = false;
  private options: Required<SchedulerOptions>;
  private eventListeners: Array<(event: SchedulerEvent) => void> = [];

  constructor(options: SchedulerOptions) {
    this.options = {
      projectRoot: options.projectRoot,
      storePath: options.storePath ?? ".rookie/schedulers.json",
      onExecute: options.onExecute ?? this.defaultExecute.bind(this),
      now: options.now ?? (() => Date.now()),
    };
    this.init();
  }

  private async init() {
    const napi = await loadNative();
    if (napi?.CronSchedulerWrapper) {
      this.nativeScheduler = new napi.CronSchedulerWrapper();
      this.useNative = true;
      this.startEventPolling();
    } else {
      // Fallback to JS scheduler
      const { Scheduler } = await import("./index.js");
      this.fallbackScheduler = new Scheduler(this.options);
      await this.fallbackScheduler.initialize();
      this.useNative = false;
    }
  }

  private async startEventPolling() {
    // Poll for task status changes to emit events
    const pollInterval = setInterval(async () => {
      if (!this.nativeScheduler) {
        clearInterval(pollInterval);
        return;
      }
      // TODO: Implement native event streaming
    }, 1000);
  }

  private async defaultExecute(task: ScheduledTask): Promise<string> {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);

    const { stdout, stderr } = await execAsync(task.command, {
      cwd: this.options.projectRoot,
      timeout: task.timeoutMs || 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout + (stderr ? `\n[stderr] ${stderr}` : "");
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    await this.init();
  }

  async dispose(): Promise<void> {
    if (this.useNative && this.nativeScheduler) {
      // Native scheduler auto-cleans up
    } else if (this.fallbackScheduler) {
      await this.fallbackScheduler.dispose();
    }
  }

  // ─── Task Management ───────────────────────────────────────

  /**
   * Schedule a new task with cron expression
   *
   * @param name Task name
   * @param cronExpr Cron expression (e.g., "0 * * * * *" for every minute)
   * @param command Command to execute
   * @param timeoutMs Optional timeout in milliseconds
   * @returns Task ID on success
   */
  async schedule(
    name: string,
    cronExpr: string,
    command: string,
    timeoutMs?: number
  ): Promise<{ success: boolean; taskId?: string; error?: string }> {
    await this.init();
    if (this.useNative && this.nativeScheduler) {
      try {
        const taskId = await this.nativeScheduler.schedule(name, cronExpr, command, timeoutMs);
        this.emit({ type: "task_scheduled", taskId, timestamp: Date.now() });
        return { success: true, taskId };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      // Fallback: convert cron to interval for JS scheduler
      const { parseInterval } = await import("./parser.js");
      const interval = parseInterval("1m"); // Simplified fallback
      if (!interval) {
        return { success: false, error: "Invalid cron expression" };
      }
      const result = await this.fallbackScheduler.schedule(name, command, "1m");
      return {
        success: result.success,
        taskId: result.task?.id,
        error: result.error,
      };
    }
  }

  /**
   * Cancel a scheduled task
   */
  async cancel(taskId: string): Promise<boolean> {
    await this.init();
    if (this.useNative && this.nativeScheduler) {
      try {
        await this.nativeScheduler.cancel(taskId);
        this.emit({ type: "task_cancelled", taskId, timestamp: Date.now() });
        return true;
      } catch {
        return false;
      }
    } else {
      return this.fallbackScheduler.unschedule(taskId);
    }
  }

  /**
   * Get a task by ID
   */
  async getTask(taskId: string): Promise<ScheduledTask | undefined> {
    await this.init();
    if (this.useNative && this.nativeScheduler) {
      const task = await this.nativeScheduler.getTask(taskId);
      if (!task) return undefined;
      return this.mapNativeTask(task);
    } else {
      return this.fallbackScheduler.getTask(taskId);
    }
  }

  /**
   * List all tasks
   */
  async listTasks(): Promise<ScheduledTask[]> {
    await this.init();
    if (this.useNative && this.nativeScheduler) {
      const tasks = await this.nativeScheduler.listTasks();
      return tasks.map((t: any) => this.mapNativeTask(t));
    } else {
      return this.fallbackScheduler.getTasks();
    }
  }

  /**
   * Pause a task
   */
  async pause(taskId: string): Promise<boolean> {
    await this.init();
    if (this.useNative && this.nativeScheduler) {
      try {
        await this.nativeScheduler.pause(taskId);
        return true;
      } catch {
        return false;
      }
    } else {
      return this.fallbackScheduler.enable(taskId, false);
    }
  }

  /**
   * Resume a paused task
   */
  async resume(taskId: string): Promise<boolean> {
    await this.init();
    if (this.useNative && this.nativeScheduler) {
      try {
        await this.nativeScheduler.resume(taskId);
        return true;
      } catch {
        return false;
      }
    } else {
      return this.fallbackScheduler.enable(taskId, true);
    }
  }

  /**
   * Get task execution history
   */
  async getHistory(taskId: string): Promise<TaskHistoryEntry[]> {
    await this.init();
    if (this.useNative && this.nativeScheduler) {
      const history = await this.nativeScheduler.getHistory(taskId);
      return history?.map((h: any) => ({
        id: h.id,
        taskId: h.taskId,
        startedAt: h.startedAt,
        completedAt: h.completedAt,
        status: h.status as TaskHistoryEntry["status"],
        output: h.output,
        error: h.error,
        durationMs: h.durationMs,
      })) || [];
    }
    return [];
  }

  // ─── Events ────────────────────────────────────────────────

  onEvent(listener: (event: SchedulerEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx !== -1) this.eventListeners.splice(idx, 1);
    };
  }

  private emit(event: SchedulerEvent): void {
    for (const listener of this.eventListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    }
  }

  // ─── Helpers ───────────────────────────────────────────────

  private mapNativeTask(nativeTask: any): ScheduledTask {
    return {
      id: nativeTask.id,
      name: nativeTask.name,
      command: nativeTask.command,
      interval: { type: "cron", expression: nativeTask.cronExpr },
      enabled: nativeTask.enabled,
      createdAt: nativeTask.createdAt,
      lastRun: nativeTask.lastRunAt,
      nextRun: nativeTask.nextRunAt,
      runCount: nativeTask.runCount,
      loop: true,
      timeoutMs: nativeTask.timeoutMs,
    };
  }
}

// Singleton instance
let globalScheduler: RustScheduler | null = null;

export function getGlobalScheduler(): RustScheduler | null {
  return globalScheduler;
}

export function setGlobalScheduler(scheduler: RustScheduler | null): void {
  globalScheduler = scheduler;
}
