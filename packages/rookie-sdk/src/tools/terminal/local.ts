/**
 * Local terminal backend
 *
 * Executes commands on the local machine using Node.js child_process.
 * Refactored from the original shell.ts implementation.
 */

import { exec, spawn, ExecOptions, ChildProcess } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  TerminalBackend,
  TerminalBackendRegistry,
} from "./backend.js";
import {
  TerminalCapabilities,
  TerminalExecuteOptions,
  TerminalExecuteResult,
  FileSystemEntry,
  SandboxConfig,
  TerminalBackendOptions,
} from "./types.js";

const execAsync = promisify(exec);

// B9.3: Read-only command sets (from CCB BashTool)
const READONLY_COMMAND_SETS = {
  // Information commands (ls, cat, head, etc.)
  info: new Set([
    "ls", "cat", "head", "tail", "wc", "file", "stat", "du", "df",
    "pwd", "echo", "date", "whoami", "uname", "env", "printenv",
    "which", "whereis", "type",
  ]),
  // Git read commands
  gitRead: new Set([
    "git log", "git diff", "git status", "git show", "git branch",
    "git tag", "git remote", "git rev-parse", "git config", "git stash list",
  ]),
  // Search commands
  search: new Set([
    "grep", "rg", "find", "fd", "ag", "ack", "locate",
  ]),
  // Inspect commands
  inspect: new Set([
    "file", "stat", "lsof", "ps", "top", "htop", "free", "uptime", "vm_stat",
  ]),
};

// Default denied patterns for security
const DEFAULT_DENIED_PATTERNS: RegExp[] = [
  /\bsudo\b/i,                            // sudo
  /\bmkfs\b/i,                            // mkfs
  /\bdd\s+if=/i,                          // dd
  /\b(?:chmod|chown)\s+.*\s\//i,       // chmod/chown on root paths
  />;?\s*\/dev\/(?:sda|nvme)/i,          // write to block devices
  /\brm\s+-rf\s+\//i,                     // rm -rf /
  /:\(\)\{\s*:\|:&\s*\};:/i,             // fork bomb
];

/**
 * Check if command is read-only
 */
function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();

  // Check git read commands first (multi-word)
  for (const gitCmd of READONLY_COMMAND_SETS.gitRead) {
    if (trimmed.startsWith(gitCmd)) return true;
  }

  // Extract first token for single-word commands
  const firstToken = trimmed.split(/\s+/)[0];

  return (
    READONLY_COMMAND_SETS.info.has(firstToken) ||
    READONLY_COMMAND_SETS.search.has(firstToken) ||
    READONLY_COMMAND_SETS.inspect.has(firstToken)
  );
}

/**
 * Local terminal backend implementation
 */
export class LocalTerminalBackend extends TerminalBackend {
  readonly id = "local";
  readonly type = "local";
  readonly name = "Local Shell";

  private currentDirectory: string;
  private environment: Map<string, string>;
  private deniedPatterns: RegExp[];
  private runningProcesses = new Map<number, ChildProcess>();

  constructor(options: TerminalBackendOptions = {}) {
    super(options);
    this.currentDirectory = (options.config as any)?.cwd || process.cwd();
    this.environment = new Map(Object.entries(process.env as Record<string, string>));
    this.deniedPatterns = [...DEFAULT_DENIED_PATTERNS];

    // Add custom denied patterns from options
    if ((options.config as any)?.deniedPatterns) {
      this.deniedPatterns.push(...(options.config as any).deniedPatterns as RegExp[]);
    }
  }

  // ─── Capabilities & Lifecycle ──────────────────────────────

  async getCapabilities(): Promise<TerminalCapabilities> {
    return {
      interactive: true,
      fileSystem: true,
      processManagement: true,
      environment: true,
      signals: true,
      maxCommandLength: os.platform() === "win32" ? 8191 : 131072,
      supportedShells: ["bash", "sh", "zsh", "fish"],
    };
  }

  async isAvailable(): Promise<boolean> {
    return true; // Local backend is always available
  }

  async initialize(): Promise<void> {
    // Verify we can execute commands
    try {
      await execAsync("echo test", { cwd: this.currentDirectory });
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize local backend: ${error}`);
    }
  }

  async dispose(): Promise<void> {
    // Kill all running background tasks
    for (const [pid, process] of this.runningProcesses) {
      process.kill("SIGTERM");
    }
    this.runningProcesses.clear();
    this.initialized = false;
  }

  // ─── Command Execution ─────────────────────────────────────

  protected async executeInternal(
    command: string,
    options: Required<TerminalExecuteOptions>
  ): Promise<TerminalExecuteResult> {
    // Security check
    const denied = this.validateCommand(command, this.deniedPatterns);
    if (denied) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `[BLOCKED] ${denied}`,
        output: `[BLOCKED] ${denied}`,
        durationMs: 0,
        timedOut: false,
        killed: false,
      };
    }

    const startTime = Date.now();
    const cwd = options.cwd || this.currentDirectory;

    // Merge environment variables
    const env = { ...process.env, ...options.env };

    const execOptions: ExecOptions = {
      cwd,
      timeout: options.timeout,
      maxBuffer: options.maxOutputSize,
      env,
      encoding: "utf8",
    };

    try {
      const { stdout, stderr } = (await execAsync(command, execOptions)) as unknown as { stdout: string; stderr: string };
      const durationMs = Date.now() - startTime;

      let output = stdout || "";
      if (stderr) {
        output += `\n[stderr]\n${stderr}`;
      }

      // Truncate if needed
      output = this.truncateOutput(output, options.maxOutputSize);

      return {
        exitCode: 0,
        stdout: stdout || "",
        stderr: stderr || "",
        output,
        durationMs,
        timedOut: false,
        killed: false,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      const stdout = String(error.stdout || "");
      const stderr = String(error.stderr || "");
      let output = stdout;
      if (stderr) {
        output += `\n[stderr]\n${stderr}`;
      }

      // Truncate if needed
      output = this.truncateOutput(output, options.maxOutputSize);

      const timedOut = error.killed === true && error.signal === "SIGTERM";
      const killed = error.killed === true;

      if (timedOut) {
        output += `\n[ERROR] Command timed out after ${options.timeout}ms`;
      }

      return {
        exitCode: error.code || 1,
        stdout,
        stderr,
        output,
        durationMs,
        timedOut,
        killed,
      };
    }
  }

  protected async executeBackgroundInternal(
    command: string,
    options: Required<TerminalExecuteOptions>,
    taskId: string
  ): Promise<void> {
    const cwd = options.cwd || this.currentDirectory;
    const env = { ...process.env, ...options.env };

    // Spawn the process
    const child = spawn("sh", ["-c", command], {
      cwd,
      env,
      detached: false,
    });

    const task = this.backgroundTasks.get(taskId);
    if (task) {
      task.pid = child.pid;
      this.runningProcesses.set(child.pid!, child);
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
      if (task) {
        task.output = stdout;
      }
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
      if (task) {
        task.errorOutput = stderr;
      }
    });

    child.on("close", (code) => {
      this.runningProcesses.delete(child.pid!);
      if (task) {
        task.status = code === 0 ? "completed" : "failed";
        task.endTime = Date.now();
        task.exitCode = code ?? undefined;
        task.output = stdout;
        task.errorOutput = stderr;
        this.emit("background:complete", { taskId, exitCode: code });
      }
    });

    child.on("error", (error) => {
      this.runningProcesses.delete(child.pid!);
      if (task) {
        task.status = "failed";
        task.endTime = Date.now();
        task.errorOutput += `\n[ERROR] ${error.message}`;
        this.emit("background:error", { taskId, error });
      }
    });

    // Set up timeout
    if (options.timeout > 0) {
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill(options.timeoutSignal);
          if (task) {
            task.status = "cancelled";
            task.endTime = Date.now();
            this.emit("background:timeout", { taskId });
          }
        }
      }, options.timeout);
    }
  }

  async killProcess(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<boolean> {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  // ─── File System Operations ────────────────────────────────

  async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolvePathSync(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string, encoding: BufferEncoding = "utf8"): Promise<string | Buffer> {
    const resolved = this.resolvePathSync(filePath);
    return fs.readFile(resolved, encoding);
  }

  async writeFile(
    filePath: string,
    content: string | Buffer,
    encoding: BufferEncoding = "utf8"
  ): Promise<void> {
    const resolved = this.resolvePathSync(filePath);
    const dir = path.dirname(resolved);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolved, content, encoding);
  }

  async deleteFile(filePath: string): Promise<void> {
    const resolved = this.resolvePathSync(filePath);
    await fs.unlink(resolved);
  }

  async createDirectory(dirPath: string, recursive = true): Promise<void> {
    const resolved = this.resolvePathSync(dirPath);
    await fs.mkdir(resolved, { recursive });
  }

  async deleteDirectory(dirPath: string, recursive = false): Promise<void> {
    const resolved = this.resolvePathSync(dirPath);
    if (recursive) {
      await fs.rm(resolved, { recursive: true, force: true });
    } else {
      await fs.rmdir(resolved);
    }
  }

  async listDirectory(dirPath: string): Promise<FileSystemEntry[]> {
    const resolved = this.resolvePathSync(dirPath);
    const entries = await fs.readdir(resolved, { withFileTypes: true });

    return Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(resolved, entry.name);
        const stats = await fs.stat(fullPath);

        let type: FileSystemEntry["type"] = "other";
        if (entry.isFile()) type = "file";
        else if (entry.isDirectory()) type = "directory";
        else if (entry.isSymbolicLink()) type = "symlink";

        return {
          name: entry.name,
          path: fullPath,
          type,
          size: stats.size,
          modifiedAt: stats.mtimeMs,
          permissions: stats.mode.toString(8).slice(-3),
        };
      })
    );
  }

  async getFileInfo(filePath: string): Promise<FileSystemEntry | null> {
    const resolved = this.resolvePathSync(filePath);
    try {
      const stats = await fs.stat(resolved);
      const name = path.basename(resolved);

      let type: FileSystemEntry["type"] = "other";
      if (stats.isFile()) type = "file";
      else if (stats.isDirectory()) type = "directory";
      else if (stats.isSymbolicLink()) type = "symlink";

      return {
        name,
        path: resolved,
        type,
        size: stats.size,
        modifiedAt: stats.mtimeMs,
        permissions: stats.mode.toString(8).slice(-3),
      };
    } catch {
      return null;
    }
  }

  // ─── Environment Operations ────────────────────────────────

  async setEnvironmentVariable(key: string, value: string): Promise<void> {
    this.environment.set(key, value);
    process.env[key] = value;
  }

  async getEnvironmentVariable(key: string): Promise<string | undefined> {
    return this.environment.get(key) || process.env[key];
  }

  async getEnvironmentVariables(): Promise<Record<string, string>> {
    return Object.entries(process.env).reduce((acc, [key, value]) => {
      if (value !== undefined) {
        acc[key] = value;
      }
      return acc;
    }, {} as Record<string, string>);
  }

  // ─── Path Operations ───────────────────────────────────────

  async resolvePath(filePath: string): Promise<string> {
    return this.resolvePathSync(filePath);
  }

  private resolvePathSync(filePath: string): string {
    // Handle home directory
    if (filePath.startsWith("~")) {
      filePath = path.join(os.homedir(), filePath.slice(1));
    }

    // Resolve relative to current directory
    if (!path.isAbsolute(filePath)) {
      filePath = path.join(this.currentDirectory, filePath);
    }

    return path.normalize(filePath);
  }

  async getCurrentDirectory(): Promise<string> {
    return this.currentDirectory;
  }

  async changeDirectory(dirPath: string): Promise<void> {
    const resolved = this.resolvePathSync(dirPath);

    // Verify it's a valid directory
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    this.currentDirectory = resolved;
  }

  // ─── Utility Methods ───────────────────────────────────────

  /**
   * Check if a command is read-only
   */
  isReadOnly(command: string): boolean {
    return isReadOnlyCommand(command);
  }

  /**
   * Add a denied pattern
   */
  addDeniedPattern(pattern: RegExp): void {
    this.deniedPatterns.push(pattern);
  }

  /**
   * Execute with sandbox restrictions
   */
  async executeSandboxed(
    command: string,
    sandbox: SandboxConfig,
    options?: TerminalExecuteOptions
  ): Promise<TerminalExecuteResult> {
    const sandboxedCommand = this.applySandbox(command, sandbox);
    return this.execute(sandboxedCommand, options);
  }
}

// Register the backend
TerminalBackendRegistry.register("local", LocalTerminalBackend);
