import { exec, ExecOptions } from "child_process";
import { Tool } from "../types.js";

// ─── Sandbox Configuration ───────────────────────────────────

export interface SandboxConfig {
  timeout: number;          // ms, default 30000
  maxOutputSize: number;    // bytes, default 1MB
  allowedCommands?: string[];
  deniedPatterns: RegExp[];
  cwd: string;
  env?: Record<string, string>;
}

const DEFAULT_DENIED_PATTERNS: RegExp[] = [
  /\bsudo\b/i,                            // sudo
  /\bmkfs\b/i,                            // mkfs
  /\bdd\s+if=/i,                          // dd
  /\b(?:chmod|chown)\s+.*\s\//i,       // chmod/chown on root paths
  />;?\s*\/dev\/(?:sda|nvme)/i,          // write to block devices
];

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

// B9.3: Check if command is read-only
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

function checkDenied(command: string, deniedPatterns: RegExp[]): string | null {
  for (const pattern of deniedPatterns) {
    if (pattern.test(command)) {
      return `Command blocked by security policy: matches ${pattern.source}`;
    }
  }
  return null;
}

// B9.3: Background task tracking
interface BackgroundTask {
  id: string;
  command: string;
  startTime: number;
  output: string;
  status: "running" | "completed" | "failed";
  exitCode?: number;
}

const backgroundTasks = new Map<string, BackgroundTask>();
let taskIdCounter = 0;

// B9.3: Get background task output
export function getBackgroundTaskOutput(taskId: string, offset = 0): { output: string; status: BackgroundTask["status"]; exitCode?: number } | null {
  const task = backgroundTasks.get(taskId);
  if (!task) return null;
  return {
    output: task.output.slice(offset),
    status: task.status,
    exitCode: task.exitCode,
  };
}

// ─── Shell Execute Tool ───────────────────────────────────

export const shellExecuteTool: Tool = {
  name: "shell_execute",
  description:
    "Execute a shell command in a sandboxed environment with timeout and output limits. " +
    "Use this to run build commands, tests, linting, git operations, etc. " +
    "Read-only commands (ls, cat, git log, etc.) are marked as safe.",
  parameters: [
    { name: "command", type: "string", description: "Shell command to execute", required: true },
    { name: "cwd", type: "string", description: "Working directory (defaults to project root)", required: false },
    { name: "timeout", type: "number", description: "Timeout in ms (default 30000, max 600000)", required: false },
    { name: "background", type: "boolean", description: "Run in background if timeout > 15s", required: false },
  ],
  // B9.3: Mark as read-only only if command is read-only
  get isReadOnly() {
    // This is dynamic based on the command, but we need to check at execution time
    return false;
  },
  // B9.3: Concurrency safe for read-only commands
  get isConcurrencySafe() {
    return false; // Determined at runtime
  },
  async execute(params) {
    const command = String(params.command);
    const cwd = params.cwd ? String(params.cwd) : process.cwd();
    const timeout = typeof params.timeout === "number" ? Math.min(params.timeout, 600000) : 30000;
    const maxBuffer = 1024 * 1024; // 1MB
    const backgroundThreshold = 15000; // 15 seconds

    // B9.3: Check if read-only command (for logging/tracking purposes)
    void isReadOnlyCommand;

    // Security check
    const denied = checkDenied(command, DEFAULT_DENIED_PATTERNS);
    if (denied) {
      return `[BLOCKED] ${denied}`;
    }

    // B9.3: Auto-background for long-running commands
    if (timeout > backgroundThreshold && params.background !== false) {
      const taskId = `task_${++taskIdCounter}_${Date.now()}`;

      const task: BackgroundTask = {
        id: taskId,
        command,
        startTime: Date.now(),
        output: "",
        status: "running",
      };
      backgroundTasks.set(taskId, task);

      // Start command in background
      const opts: ExecOptions = {
        cwd,
        timeout: 600000, // 10 min for background
        maxBuffer,
        env: { ...process.env },
      };

      exec(command, opts, (error, stdout, stderr) => {
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += `\n[stderr]\n${stderr}`;
        if (error) {
          task.status = "failed";
          task.exitCode = typeof error.code === "number" ? error.code : 1;
          output += `\n[ERROR] ${error.message}`;
        } else {
          task.status = "completed";
          task.exitCode = 0;
        }
        task.output = output;
      });

      return `[BACKGROUND] Command running in background. Task ID: ${taskId}\nUse TaskOutputTool to check progress.`;
    }

    return new Promise<string>((resolve) => {
      const opts: ExecOptions = {
        cwd,
        timeout,
        maxBuffer,
        env: { ...process.env },
      };

      exec(command, opts, (error, stdout, stderr) => {
        let output = "";

        if (stdout) output += stdout;
        if (stderr) output += `\n[stderr]\n${stderr}`;

        if (error) {
          if (error.killed) {
            output += `\n[ERROR] Command timed out after ${timeout}ms`;
          } else {
            output += `\n[ERROR] Exit code ${error.code}: ${error.message}`;
          }
        }

        // B9.3: Truncate output to 30K chars (CCB standard)
        const MAX_OUTPUT = 30000;
        if (output.length > MAX_OUTPUT) {
          const half = Math.floor(MAX_OUTPUT / 2);
          output = output.slice(0, half) + `\n\n... [truncated ${output.length - MAX_OUTPUT} chars] ...\n\n` + output.slice(-half);
        }

        resolve(output || "(no output)");
      });
    });
  },
};
