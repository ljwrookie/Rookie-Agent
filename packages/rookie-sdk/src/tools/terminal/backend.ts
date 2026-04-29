/**
 * Terminal backend abstract base class
 *
 * Provides common functionality and interface for all terminal backends.
 */

import { EventEmitter } from "events";
import {
  ITerminalBackend,
  TerminalBackendOptions,
  TerminalCapabilities,
  TerminalExecuteOptions,
  TerminalExecuteResult,
  BackgroundTask,
  BackgroundTaskStatus,
  FileSystemEntry,
  SandboxConfig,
} from "./types.js";

/**
 * Abstract base class for terminal backends
 *
 * Implements common functionality and defines the interface
 * that all backends must implement.
 */
export abstract class TerminalBackend extends EventEmitter implements ITerminalBackend {
  /** Backend identifier */
  abstract readonly id: string;
  /** Backend type */
  abstract readonly type: string;
  /** Backend display name */
  abstract readonly name: string;

  /** Backend options */
  protected options: TerminalBackendOptions;
  /** Whether the backend is initialized */
  protected initialized = false;
  /** Background tasks */
  protected backgroundTasks = new Map<string, BackgroundTask>();
  /** Task ID counter */
  protected taskIdCounter = 0;
  /** Default timeout */
  protected defaultTimeout: number;
  /** Maximum output size */
  protected maxOutputSize: number;

  constructor(options: TerminalBackendOptions = {}) {
    super();
    this.options = options;
    this.defaultTimeout = options.defaultTimeout ?? 30000;
    this.maxOutputSize = options.maxOutputSize ?? 1024 * 1024; // 1MB
  }

  /**
   * Get backend capabilities
   */
  abstract getCapabilities(): Promise<TerminalCapabilities>;

  /**
   * Check if backend is available
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Initialize the backend
   */
  abstract initialize(): Promise<void>;

  /**
   * Dispose of the backend
   */
  abstract dispose(): Promise<void>;

  /**
   * Execute a command (to be implemented by subclasses)
   */
  protected abstract executeInternal(
    command: string,
    options: Required<TerminalExecuteOptions>
  ): Promise<TerminalExecuteResult>;

  /**
   * Execute a command in the background (to be implemented by subclasses)
   */
  protected abstract executeBackgroundInternal(
    command: string,
    options: Required<TerminalExecuteOptions>,
    taskId: string
  ): Promise<void>;

  /**
   * Kill a process by PID (to be implemented by subclasses)
   */
  abstract killProcess(pid: number, signal?: "SIGTERM" | "SIGKILL"): Promise<boolean>;

  /**
   * Check if a path exists (to be implemented by subclasses)
   */
  abstract pathExists(path: string): Promise<boolean>;

  /**
   * Read a file (to be implemented by subclasses)
   */
  abstract readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer>;

  /**
   * Write a file (to be implemented by subclasses)
   */
  abstract writeFile(path: string, content: string | Buffer, encoding?: BufferEncoding): Promise<void>;

  /**
   * Delete a file (to be implemented by subclasses)
   */
  abstract deleteFile(path: string): Promise<void>;

  /**
   * Create a directory (to be implemented by subclasses)
   */
  abstract createDirectory(path: string, recursive?: boolean): Promise<void>;

  /**
   * Delete a directory (to be implemented by subclasses)
   */
  abstract deleteDirectory(path: string, recursive?: boolean): Promise<void>;

  /**
   * List directory contents (to be implemented by subclasses)
   */
  abstract listDirectory(path: string): Promise<FileSystemEntry[]>;

  /**
   * Get file/directory info (to be implemented by subclasses)
   */
  abstract getFileInfo(path: string): Promise<FileSystemEntry | null>;

  /**
   * Set environment variable (to be implemented by subclasses)
   */
  abstract setEnvironmentVariable(key: string, value: string): Promise<void>;

  /**
   * Get environment variable (to be implemented by subclasses)
   */
  abstract getEnvironmentVariable(key: string): Promise<string | undefined>;

  /**
   * Get all environment variables (to be implemented by subclasses)
   */
  abstract getEnvironmentVariables(): Promise<Record<string, string>>;

  /**
   * Resolve a path (to be implemented by subclasses)
   */
  abstract resolvePath(path: string): Promise<string>;

  /**
   * Get current working directory (to be implemented by subclasses)
   */
  abstract getCurrentDirectory(): Promise<string>;

  /**
   * Change working directory (to be implemented by subclasses)
   */
  abstract changeDirectory(path: string): Promise<void>;

  // ─── Common Implementation ─────────────────────────────────

  /**
   * Execute a command with normalized options
   */
  async execute(command: string, options?: TerminalExecuteOptions): Promise<TerminalExecuteResult> {
    this.ensureInitialized();

    const normalizedOptions = this.normalizeOptions(options);
    const startTime = Date.now();

    this.emit("execute:start", { command, options: normalizedOptions });

    try {
      const result = await this.executeInternal(command, normalizedOptions);
      this.emit("execute:complete", { command, result, duration: Date.now() - startTime });
      return result;
    } catch (error) {
      this.emit("execute:error", { command, error, duration: Date.now() - startTime });
      throw error;
    }
  }

  /**
   * Execute a command in the background
   */
  async executeBackground(command: string, options?: TerminalExecuteOptions): Promise<string> {
    this.ensureInitialized();

    const normalizedOptions = this.normalizeOptions(options);
    const taskId = `task_${++this.taskIdCounter}_${Date.now()}`;

    const task: BackgroundTask = {
      id: taskId,
      command,
      status: "running",
      startTime: Date.now(),
      output: "",
      errorOutput: "",
    };

    this.backgroundTasks.set(taskId, task);
    this.emit("background:start", { taskId, command });

    // Start execution
    this.executeBackgroundInternal(command, normalizedOptions, taskId).catch((error) => {
      const t = this.backgroundTasks.get(taskId);
      if (t) {
        t.status = "failed";
        t.endTime = Date.now();
        t.errorOutput += `\n[ERROR] ${error.message}`;
        this.emit("background:error", { taskId, error });
      }
    });

    return taskId;
  }

  /**
   * Get background task status
   */
  async getBackgroundTask(taskId: string): Promise<BackgroundTask | null> {
    return this.backgroundTasks.get(taskId) || null;
  }

  /**
   * Get background task output
   */
  async getBackgroundTaskOutput(
    taskId: string,
    offset = 0
  ): Promise<{ output: string; errorOutput: string; status: BackgroundTaskStatus; exitCode?: number } | null> {
    const task = this.backgroundTasks.get(taskId);
    if (!task) return null;

    return {
      output: task.output.slice(offset),
      errorOutput: task.errorOutput.slice(offset),
      status: task.status,
      exitCode: task.exitCode,
    };
  }

  /**
   * Cancel a background task
   */
  async cancelBackgroundTask(
    taskId: string,
    signal: "SIGTERM" | "SIGKILL" = "SIGTERM"
  ): Promise<boolean> {
    const task = this.backgroundTasks.get(taskId);
    if (!task || task.status !== "running") {
      return false;
    }

    if (task.pid) {
      await this.killProcess(task.pid, signal);
    }

    task.status = "cancelled";
    task.endTime = Date.now();
    this.emit("background:cancelled", { taskId });
    return true;
  }

  /**
   * List all background tasks
   */
  async listBackgroundTasks(): Promise<BackgroundTask[]> {
    return Array.from(this.backgroundTasks.values());
  }

  /**
   * Clean up completed background tasks older than maxAgeMs
   */
  async cleanupBackgroundTasks(maxAgeMs = 3600000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, task] of this.backgroundTasks) {
      if (task.status !== "running" && task.endTime && now - task.endTime > maxAgeMs) {
        this.backgroundTasks.delete(taskId);
        cleaned++;
      }
    }

    return cleaned;
  }

  // ─── Protected Helpers ─────────────────────────────────────

  /**
   * Ensure backend is initialized
   */
  protected ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Backend ${this.id} not initialized. Call initialize() first.`);
    }
  }

  /**
   * Normalize execution options
   */
  protected normalizeOptions(options?: TerminalExecuteOptions): Required<TerminalExecuteOptions> {
    const cwd = options?.cwd || process.cwd();
    return {
      cwd,
      env: options?.env || {},
      timeout: Math.min(options?.timeout ?? this.defaultTimeout, 600000), // Max 10 minutes
      maxOutputSize: options?.maxOutputSize ?? this.maxOutputSize,
      background: options?.background ?? false,
      timeoutSignal: options?.timeoutSignal ?? "SIGTERM",
    };
  }

  /**
   * Truncate output to max size
   */
  protected truncateOutput(output: string, maxSize: number): string {
    if (output.length <= maxSize) return output;

    const half = Math.floor(maxSize / 2);
    return (
      output.slice(0, half) +
      `\n\n... [truncated ${output.length - maxSize} chars] ...\n\n` +
      output.slice(-half)
    );
  }

  /**
   * Update background task status
   */
  protected updateBackgroundTask(
    taskId: string,
    updates: Partial<BackgroundTask>
  ): BackgroundTask | null {
    const task = this.backgroundTasks.get(taskId);
    if (!task) return null;

    Object.assign(task, updates);
    return task;
  }

  /**
   * Apply sandbox configuration to command
   */
  protected applySandbox(command: string, sandbox?: SandboxConfig): string {
    if (!sandbox) return command;

    let wrappedCommand = command;

    // Apply timeout if specified
    if (sandbox.resources?.cpuTime) {
      wrappedCommand = `timeout ${sandbox.resources.cpuTime}s ${wrappedCommand}`;
    }

    // Apply resource limits using ulimit
    const limits: string[] = [];
    if (sandbox.resources?.memory) {
      limits.push(`ulimit -v ${Math.floor(sandbox.resources.memory / 1024)}`); // KB
    }
    if (sandbox.resources?.fileSize) {
      limits.push(`ulimit -f ${Math.floor(sandbox.resources.fileSize / 512)}`); // 512-byte blocks
    }
    if (sandbox.resources?.openFiles) {
      limits.push(`ulimit -n ${sandbox.resources.openFiles}`);
    }
    if (sandbox.resources?.processes) {
      limits.push(`ulimit -u ${sandbox.resources.processes}`);
    }

    if (limits.length > 0) {
      wrappedCommand = `${limits.join(" && ")} && ${wrappedCommand}`;
    }

    return wrappedCommand;
  }

  /**
   * Validate command against security patterns
   */
  protected validateCommand(command: string, deniedPatterns: RegExp[]): string | null {
    for (const pattern of deniedPatterns) {
      if (pattern.test(command)) {
        return `Command blocked by security policy: matches ${pattern.source}`;
      }
    }
    return null;
  }

  /**
   * Parse file system entry from ls/ stat output
   */
  protected parseFileEntry(line: string, basePath: string): FileSystemEntry | null {
    // Basic parsing for "ls -la" output
    const match = line.match(/^([\-dl])([rwx\-]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w+\s+\d+\s+[\d:]+)\s+(.+)$/);
    if (!match) return null;

    const [, type, , size, , name] = match;
    const fullPath = `${basePath}/${name}`.replace(/\/+/g, "/");

    return {
      name,
      path: fullPath,
      type: type === "d" ? "directory" : type === "l" ? "symlink" : "file",
      size: parseInt(size, 10),
      modifiedAt: Date.now(), // TODO: Parse actual date
      permissions: match[2],
    };
  }
}

/**
 * Terminal backend registry
 */
export class TerminalBackendRegistry {
  private static backends = new Map<string, new (options: TerminalBackendOptions) => TerminalBackend>();

  /**
   * Register a backend type
   */
  static register(
    type: string,
    constructor: new (options: TerminalBackendOptions) => TerminalBackend
  ): void {
    this.backends.set(type, constructor);
  }

  /**
   * Create a backend instance
   */
  static create(type: string, options: TerminalBackendOptions = {}): TerminalBackend {
    const Backend = this.backends.get(type);
    if (!Backend) {
      throw new Error(`Unknown backend type: ${type}`);
    }
    return new Backend(options);
  }

  /**
   * List available backend types
   */
  static list(): string[] {
    return Array.from(this.backends.keys());
  }

  /**
   * Check if a backend type is registered
   */
  static has(type: string): boolean {
    return this.backends.has(type);
  }
}
