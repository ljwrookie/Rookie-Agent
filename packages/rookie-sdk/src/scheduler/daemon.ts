/**
 * Scheduler Daemon (D6)
 *
 * Process-level daemon with:
 * - Exponential backoff restart (1s → 2s → 4s → ... → 5min)
 * - EXIT_CODE_PERMANENT=78 for permanent failures
 * - Recovery of pending tasks on startup
 * - Logs to ~/.rookie/scheduler/logs/
 */

import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";

// Exit codes
export const EXIT_CODE_PERMANENT = 78;
export const EXIT_CODE_RESTART = 79;

// Paths
const ROOKIE_DIR = join(homedir(), ".rookie");
const SCHEDULER_DIR = join(ROOKIE_DIR, "scheduler");
const PENDING_DIR = join(SCHEDULER_DIR, "pending");
const LOGS_DIR = join(SCHEDULER_DIR, "logs");
const PID_FILE = join(SCHEDULER_DIR, "daemon.pid");

// Backoff configuration
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_MULTIPLIER = 2;

export interface DaemonOptions {
  projectRoot: string;
  autoRestart?: boolean;
  maxRestarts?: number;
  onLog?: (level: "info" | "error" | "warn", message: string, meta?: Record<string, unknown>) => void;
}

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  startTime?: number;
  restartCount: number;
  lastError?: string;
}

export interface PendingTask {
  id: string;
  name: string;
  command: string;
  scheduledAt: number;
  retryCount: number;
}

/**
 * SchedulerDaemon: Process-level daemon with exponential backoff restart.
 * D6: Scheduler Daemon + restart recovery
 */
export class SchedulerDaemon extends EventEmitter {
  private options: Required<DaemonOptions>;
  private child: ChildProcess | null = null;
  private restartCount = 0;
  private currentBackoff = INITIAL_BACKOFF_MS;
  private startTime: number | null = null;
  private stopping = false;
  private logStream?: fs.FileHandle;

  constructor(options: DaemonOptions) {
    super();
    this.options = {
      autoRestart: true,
      maxRestarts: 10,
      onLog: () => {},
      ...options,
    };
  }

  /**
   * Start the daemon.
   */
  async start(): Promise<void> {
    if (this.child) {
      throw new Error("Daemon already running");
    }

    // Ensure directories exist
    await fs.mkdir(PENDING_DIR, { recursive: true });
    await fs.mkdir(LOGS_DIR, { recursive: true });

    // Open log file
    const logPath = join(LOGS_DIR, `${Date.now()}.log`);
    this.logStream = await fs.open(logPath, "a");

    this.log("info", "Daemon starting", { projectRoot: this.options.projectRoot });

    // Check for existing daemon
    await this.killExistingDaemon();

    // Recover pending tasks
    await this.recoverPendingTasks();

    // Start worker process
    await this.spawnWorker();

    // Write PID file
    await fs.writeFile(PID_FILE, String(process.pid));
  }

  /**
   * Stop the daemon.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    this.log("info", "Daemon stopping");

    if (this.child) {
      this.child.kill("SIGTERM");

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.child?.kill("SIGKILL");
          resolve();
        }, 5000);

        this.child?.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.child = null;
    }

    // Cleanup PID file
    try {
      await fs.unlink(PID_FILE);
    } catch {
      // Ignore
    }

    // Close log stream
    await this.logStream?.close();

    this.emit("stopped");
  }

  /**
   * Get daemon status.
   */
  getStatus(): DaemonStatus {
    return {
      running: this.child !== null && !this.child.killed,
      pid: this.child?.pid,
      startTime: this.startTime ?? undefined,
      restartCount: this.restartCount,
    };
  }

  /**
   * Add a pending task for execution.
   */
  async addPendingTask(task: Omit<PendingTask, "id" | "retryCount">): Promise<PendingTask> {
    const pendingTask: PendingTask = {
      ...task,
      id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      retryCount: 0,
    };

    const taskPath = join(PENDING_DIR, `${pendingTask.id}.json`);
    await fs.writeFile(taskPath, JSON.stringify(pendingTask, null, 2));

    this.log("info", "Pending task added", { taskId: pendingTask.id, name: pendingTask.name });

    return pendingTask;
  }

  /**
   * List pending tasks.
   */
  async listPendingTasks(): Promise<PendingTask[]> {
    try {
      const files = await fs.readdir(PENDING_DIR);
      const tasks: PendingTask[] = [];

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const content = await fs.readFile(join(PENDING_DIR, file), "utf-8");
          const task = JSON.parse(content) as PendingTask;
          tasks.push(task);
        } catch {
          // Skip invalid files
        }
      }

      return tasks.sort((a, b) => a.scheduledAt - b.scheduledAt);
    } catch {
      return [];
    }
  }

  /**
   * Remove a pending task.
   */
  async removePendingTask(taskId: string): Promise<boolean> {
    try {
      await fs.unlink(join(PENDING_DIR, `${taskId}.json`));
      return true;
    } catch {
      return false;
    }
  }

  // ─── Internal ──────────────────────────────────────────

  private async spawnWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.startTime = Date.now();

      // Spawn worker process
      this.child = spawn(process.execPath, [
        "--eval",
        `
          const { SchedulerWorker } = require('${__filename.replace(/daemon\.js$/, "worker.js")}');
          const worker = new SchedulerWorker();
          worker.run();
        `,
      ], {
        cwd: this.options.projectRoot,
        env: {
          ...process.env,
          ROOKIE_SCHEDULER_DAEMON: "1",
          ROOKIE_PROJECT_ROOT: this.options.projectRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });

      this.log("info", "Worker spawned", { pid: this.child.pid });

      // Handle stdout
      this.child.stdout?.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
          this.log("info", `[worker] ${line}`);
        }
      });

      // Handle stderr
      this.child.stderr?.on("data", (data: Buffer) => {
        const lines = data.toString().trim().split("\n");
        for (const line of lines) {
          this.log("error", `[worker] ${line}`);
        }
      });

      // Handle exit
      this.child.on("exit", (code, signal) => {
        this.handleWorkerExit(code, signal);
      });

      this.child.on("error", (err) => {
        this.log("error", "Worker error", { error: err.message });
        reject(err);
      });

      // Give worker time to start
      setTimeout(() => resolve(), 100);
    });
  }

  private async handleWorkerExit(code: number | null, signal: string | null): Promise<void> {
    this.child = null;

    // Check for permanent failure
    if (code === EXIT_CODE_PERMANENT) {
      this.log("error", "Worker exited with permanent failure code, not restarting", { code });
      this.emit("permanent_failure", { code });
      return;
    }

    // Check if we're stopping
    if (this.stopping) {
      this.log("info", "Worker stopped (daemon stopping)");
      return;
    }

    // Check restart limit
    if (this.restartCount >= this.options.maxRestarts) {
      this.log("error", "Max restarts reached, giving up", { restartCount: this.restartCount });
      this.emit("max_restarts");
      return;
    }

    // Check if auto-restart is enabled
    if (!this.options.autoRestart) {
      this.log("info", "Auto-restart disabled, not restarting");
      this.emit("stopped");
      return;
    }

    // Calculate backoff
    const backoff = Math.min(this.currentBackoff, MAX_BACKOFF_MS);
    this.currentBackoff *= BACKOFF_MULTIPLIER;
    this.restartCount++;

    this.log("info", `Worker exited (code=${code}, signal=${signal}), restarting in ${backoff}ms`, {
      code,
      signal,
      restartCount: this.restartCount,
      backoff,
    });

    // Wait for backoff then restart
    await new Promise((resolve) => setTimeout(resolve, backoff));

    if (!this.stopping) {
      await this.spawnWorker();
    }
  }

  private async killExistingDaemon(): Promise<void> {
    try {
      const pidContent = await fs.readFile(PID_FILE, "utf-8");
      const pid = parseInt(pidContent.trim(), 10);

      if (pid && pid !== process.pid) {
        try {
          process.kill(pid, 0); // Check if process exists
          // Process exists, kill it
          process.kill(pid, "SIGTERM");
          this.log("info", "Killed existing daemon", { pid });

          // Wait for it to die
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch {
          // Process doesn't exist
        }
      }
    } catch {
      // No PID file
    }
  }

  private async recoverPendingTasks(): Promise<void> {
    const tasks = await this.listPendingTasks();

    if (tasks.length > 0) {
      this.log("info", `Recovered ${tasks.length} pending tasks`, { count: tasks.length });

      for (const task of tasks) {
        this.emit("pending_task", task);
      }
    }
  }

  private log(level: "info" | "error" | "warn", message: string, meta?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const logLine = JSON.stringify({
      timestamp,
      level,
      message,
      ...meta,
    }) + "\n";

    // Write to log file
    this.logStream?.write(logLine).catch(() => {});

    // Call user handler
    this.options.onLog(level, message, meta);

    // Emit event
    this.emit("log", { level, message, meta, timestamp });
  }
}

/**
 * Check if daemon is running.
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const pidContent = await fs.readFile(PID_FILE, "utf-8");
    const pid = parseInt(pidContent.trim(), 10);

    if (!pid) return false;

    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Get daemon logs.
 */
export async function getDaemonLogs(limit = 100): Promise<Array<{ timestamp: string; level: string; message: string }>> {
  try {
    const files = await fs.readdir(LOGS_DIR);
    const logFiles = files.filter((f) => f.endsWith(".log")).sort().reverse();

    const logs: Array<{ timestamp: string; level: string; message: string }> = [];

    for (const file of logFiles) {
      const content = await fs.readFile(join(LOGS_DIR, file), "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          logs.push({
            timestamp: entry.timestamp,
            level: entry.level,
            message: entry.message,
          });
        } catch {
          // Skip malformed lines
        }
      }

      if (logs.length >= limit) break;
    }

    return logs.slice(0, limit);
  } catch {
    return [];
  }
}
