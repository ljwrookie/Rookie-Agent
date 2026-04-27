// ─── Shell Sandbox Adapter ───────────────────────────────────────
// B5: Platform-specific sandboxing for shell execution

import { spawn, SpawnOptions } from "child_process";
import { platform } from "os";
import { resolve } from "path";

// B5: Sandbox configuration
export interface SandboxConfig {
  projectRoot: string;
  allowedDirs?: string[];      // Additional allowed directories
  allowNetwork?: boolean;      // Allow network access
  timeout?: number;            // Timeout in ms
}

// B5: Sandbox adapter interface
export interface SandboxAdapter {
  wrapCommand(command: string, args: string[]): { command: string; args: string[] };
  isAvailable(): boolean;
}

// B5: macOS sandbox-exec adapter
class MacOSSandboxAdapter implements SandboxAdapter {
  private config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  isAvailable(): boolean {
    try {
      // Check if sandbox-exec is available
      const { execSync } = require("child_process");
      execSync("which sandbox-exec", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  wrapCommand(command: string, args: string[]): { command: string; args: string[] } {
    const allowedDirs = [this.config.projectRoot, ...(this.config.allowedDirs || [])];

    // Build sandbox profile
    const profile = this.buildSandboxProfile(allowedDirs, this.config.allowNetwork);

    // Write profile to temp file (simplified - in production would use temp file)
    // For now, use inline profile via heredoc
    const wrappedArgs = [
      "-p",
      profile,
      command,
      ...args,
    ];

    return { command: "sandbox-exec", args: wrappedArgs };
  }

  private buildSandboxProfile(allowedDirs: string[], allowNetwork?: boolean): string {
    const lines: string[] = [
      "(version 1)",
      "(deny default)",
      // Allow reading system libraries
      '(allow file-read* (subpath "/usr"))',
      '(allow file-read* (subpath "/bin"))',
      '(allow file-read* (subpath "/sbin"))',
      '(allow file-read* (subpath "/Library"))',
      '(allow file-read* (subpath "/System"))',
      // Allow executing shell and common tools
      '(allow process-exec (subpath "/bin"))',
      '(allow process-exec (subpath "/usr/bin"))',
      '(allow process-exec (subpath "/usr/local/bin"))',
    ];

    // Allow project directories
    for (const dir of allowedDirs) {
      lines.push(`(allow file-read* file-write* (subpath "${dir}"))`);
      lines.push(`(allow process-exec (subpath "${dir}"))`);
    }

    // Network access
    if (allowNetwork) {
      lines.push('(allow network* (remote unix-socket))');
      lines.push('(allow network-inbound (local unix-socket))');
    }

    // Allow stdin/stdout/stderr
    lines.push('(allow file-read-data (literal "/dev/stdin"))');
    lines.push('(allow file-write-data (literal "/dev/stdout"))');
    lines.push('(allow file-write-data (literal "/dev/stderr"))');

    return lines.join("\n");
  }
}

// B5: Linux bubblewrap adapter
class LinuxSandboxAdapter implements SandboxAdapter {
  private config: SandboxConfig;

  constructor(config: SandboxConfig) {
    this.config = config;
  }

  isAvailable(): boolean {
    try {
      const { execSync } = require("child_process");
      execSync("which bwrap", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  wrapCommand(command: string, args: string[]): { command: string; args: string[] } {
    const allowedDirs = [this.config.projectRoot, ...(this.config.allowedDirs || [])];

    const bwrapArgs: string[] = [
      // Create new namespaces
      "--unshare-all",
      // Keep current working directory
      "--chdir", process.cwd(),
      // Read-only system directories
      "--ro-bind", "/usr", "/usr",
      "--ro-bind", "/bin", "/bin",
      "--ro-bind", "/sbin", "/sbin",
      "--ro-bind", "/lib", "/lib",
      "--ro-bind", "/lib64", "/lib64",
      // Proc and dev
      "--proc", "/proc",
      "--dev", "/dev",
      // Temporary directories
      "--tmpfs", "/tmp",
    ];

    // Bind allowed directories read-write
    for (const dir of allowedDirs) {
      const resolved = resolve(dir);
      bwrapArgs.push("--bind", resolved, resolved);
    }

    // Network
    if (!this.config.allowNetwork) {
      bwrapArgs.push("--unshare-net");
    }

    // Environment
    bwrapArgs.push("--setenv", "HOME", process.env.HOME || "/tmp");
    bwrapArgs.push("--setenv", "PATH", process.env.PATH || "/usr/bin:/bin");

    // The actual command
    bwrapArgs.push(command, ...args);

    return { command: "bwrap", args: bwrapArgs };
  }
}

// B5: Fallback / no sandbox
class NoSandboxAdapter implements SandboxAdapter {
  isAvailable(): boolean {
    return true;
  }

  wrapCommand(command: string, args: string[]): { command: string; args: string[] } {
    return { command, args };
  }
}

// B5: Sandbox factory
export function createSandboxAdapter(config: SandboxConfig): SandboxAdapter {
  const envSandbox = process.env.ROOKIE_SANDBOX?.toLowerCase();

  // Allow disabling sandbox via environment
  if (envSandbox === "off" || envSandbox === "false" || envSandbox === "0") {
    return new NoSandboxAdapter();
  }

  const plat = platform();

  if (plat === "darwin") {
    const adapter = new MacOSSandboxAdapter(config);
    if (adapter.isAvailable()) {
      return adapter;
    }
    console.warn("sandbox-exec not available, running without sandbox");
    return new NoSandboxAdapter();
  }

  if (plat === "linux") {
    const adapter = new LinuxSandboxAdapter(config);
    if (adapter.isAvailable()) {
      return adapter;
    }
    console.warn("bubblewrap (bwrap) not available, install it for sandboxing: https://github.com/containers/bubblewrap");
    return new NoSandboxAdapter();
  }

  // Windows and other platforms - no sandbox
  return new NoSandboxAdapter();
}

// B5: Check if sandbox is available
export function isSandboxAvailable(): boolean {
  const envSandbox = process.env.ROOKIE_SANDBOX?.toLowerCase();
  if (envSandbox === "off" || envSandbox === "false" || envSandbox === "0") {
    return false;
  }

  const plat = platform();

  if (plat === "darwin") {
    try {
      const { execSync } = require("child_process");
      execSync("which sandbox-exec", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  if (plat === "linux") {
    try {
      const { execSync } = require("child_process");
      execSync("which bwrap", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

// B5: Execute command with sandbox
export async function executeWithSandbox(
  command: string,
  args: string[],
  config: SandboxConfig,
  options?: SpawnOptions
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const adapter = createSandboxAdapter(config);
  const wrapped = adapter.wrapCommand(command, args);

  return new Promise((resolve, reject) => {
    const child = spawn(wrapped.command, wrapped.args, {
      ...options,
      timeout: config.timeout || 120000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode || 0 });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}
