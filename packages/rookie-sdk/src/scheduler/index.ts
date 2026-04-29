// Scheduler: Cron / Loop task management with node-cron

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { schedule as cronSchedule, validate as cronValidate } from "node-cron";
import type { ScheduledTask } from "node-cron";
import {
  SchedulerOptions,
  SchedulerStore,
  ScheduledTask as SchedulerTask,
  SchedulerEvent,
} from "./types.js";
import { loadSchedulerStore, saveSchedulerStore, generateTaskId, validateTask } from "./store.js";
import { parseInterval, intervalToCron, getNextRunTime } from "./parser.js";

const execAsync = promisify(exec);

export * from "./types.js";
export * from "./parser.js";
export * from "./store.js";

export class Scheduler {
  private store: SchedulerStore = { version: 1, tasks: [] };
  private cronJobs = new Map<string, ScheduledTask>();
  private options: Required<SchedulerOptions>;
  private eventListeners: Array<(event: SchedulerEvent) => void> = [];

  constructor(options: SchedulerOptions) {
    this.options = {
      projectRoot: options.projectRoot,
      storePath: options.storePath ?? ".rookie/schedulers.json",
      onExecute: options.onExecute ?? this.defaultExecute.bind(this),
      now: options.now ?? (() => Date.now()),
    };
  }

  // ─── Lifecycle ─────────────────────────────────────────────

  async initialize(): Promise<void> {
    this.store = await loadSchedulerStore(this.options.projectRoot, this.options.storePath);
    // Resume enabled tasks
    for (const task of this.store.tasks) {
      if (task.enabled) {
        this.startCronJob(task);
      }
    }
  }

  async dispose(): Promise<void> {
    for (const [, job] of this.cronJobs) {
      job.stop();
    }
    this.cronJobs.clear();
  }

  // ─── Task Management ───────────────────────────────────────

  async schedule(
    name: string,
    command: string,
    intervalExpr: string,
    loop: boolean = false
  ): Promise<{ success: boolean; task?: SchedulerTask; error?: string }> {
    const interval = parseInterval(intervalExpr);
    if (!interval) {
      return { success: false, error: `Invalid interval expression: ${intervalExpr}` };
    }

    const task: SchedulerTask = {
      id: generateTaskId(),
      name: name.trim(),
      command: command.trim(),
      interval,
      enabled: true,
      createdAt: this.options.now(),
      runCount: 0,
      loop,
    };

    const validationError = validateTask(task);
    if (validationError) {
      return { success: false, error: validationError };
    }

    this.store.tasks.push(task);
    await this.persist();
    this.startCronJob(task);

    this.emit({ type: "task_scheduled", taskId: task.id, timestamp: this.options.now() });
    return { success: true, task };
  }

  async unschedule(taskId: string): Promise<boolean> {
    const idx = this.store.tasks.findIndex((t) => t.id === taskId);
    if (idx === -1) return false;

    this.stopCronJob(taskId);
    this.store.tasks.splice(idx, 1);
    await this.persist();

    this.emit({ type: "task_cancelled", taskId, timestamp: this.options.now() });
    return true;
  }

  async enable(taskId: string, enabled: boolean): Promise<boolean> {
    const task = this.store.tasks.find((t) => t.id === taskId);
    if (!task) return false;

    task.enabled = enabled;
    await this.persist();

    if (enabled) {
      this.startCronJob(task);
    } else {
      this.stopCronJob(taskId);
    }
    return true;
  }

  getTasks(): SchedulerTask[] {
    return this.store.tasks.map((t) => ({ ...t }));
  }

  getTask(taskId: string): SchedulerTask | undefined {
    const t = this.store.tasks.find((x) => x.id === taskId);
    return t ? { ...t } : undefined;
  }

  // ─── Execution ─────────────────────────────────────────────

  private async defaultExecute(task: SchedulerTask): Promise<string> {
    const { stdout, stderr } = await execAsync(task.command, {
      cwd: this.options.projectRoot,
      timeout: 300000, // 5 minutes
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return stdout + (stderr ? `\n[stderr] ${stderr}` : "");
  }

  private async executeTask(task: SchedulerTask): Promise<void> {
    const startTime = this.options.now();
    this.emit({ type: "task_started", taskId: task.id, timestamp: startTime });

    try {
      const output = await this.options.onExecute(task);
      const duration = this.options.now() - startTime;

      task.lastRun = startTime;
      task.runCount++;
      task.nextRun = task.loop ? getNextRunTime(task.interval, startTime) : undefined;
      await this.persist();

      this.emit({ type: "task_completed", taskId: task.id, output, duration });

      // If loop mode, re-schedule the next run
      if (task.loop && task.enabled) {
        // Loop tasks are one-shot; they don't use cron, we handle manually
        // For now, cron-based loop is the same as regular schedule
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emit({ type: "task_failed", taskId: task.id, error: errorMsg });
    }
  }

  // ─── Cron Job Management ───────────────────────────────────

  private startCronJob(task: SchedulerTask): void {
    if (this.cronJobs.has(task.id)) {
      this.stopCronJob(task.id);
    }

    const cronExpr = intervalToCron(task.interval);

    // Validate cron expression
    if (!cronValidate(cronExpr)) {
      console.error(`[Scheduler] Invalid cron expression for task ${task.id}: ${cronExpr}`);
      return;
    }

    const job = cronSchedule(cronExpr, async () => {
      await this.executeTask(task);
    });

    this.cronJobs.set(task.id, job);

    // Calculate next run time
    task.nextRun = getNextRunTime(task.interval);
    this.persist().catch(() => {});
  }

  private stopCronJob(taskId: string): void {
    const job = this.cronJobs.get(taskId);
    if (job) {
      job.stop();
      this.cronJobs.delete(taskId);
    }
  }

  // ─── Persistence ───────────────────────────────────────────

  private async persist(): Promise<void> {
    await saveSchedulerStore(this.options.projectRoot, this.store, this.options.storePath);
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
}

// Singleton instance for CLI usage
let globalScheduler: Scheduler | null = null;

export function getGlobalScheduler(): Scheduler | null {
  return globalScheduler;
}

export function setGlobalScheduler(scheduler: Scheduler | null): void {
  globalScheduler = scheduler;
}
