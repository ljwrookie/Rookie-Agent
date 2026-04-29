/**
 * Daytona terminal backend
 *
 * Executes commands in Daytona workspaces with:
 * - Automatic workspace management
 * - Workspace hibernation/wake
 * - DevContainer support
 */

import { spawn, exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import {
  TerminalBackend,
  TerminalBackendRegistry,
} from "./backend.js";
import {
  TerminalCapabilities,
  TerminalExecuteOptions,
  TerminalExecuteResult,
  FileSystemEntry,
  DaytonaConfig,
  TerminalBackendOptions,
} from "./types.js";

const execAsync = promisify(exec);

/**
 * Daytona workspace state
 */
type WorkspaceState = "unknown" | "creating" | "started" | "stopped" | "error";

/**
 * Daytona API response types
 */
interface DaytonaWorkspace {
  id: string;
  name: string;
  state: WorkspaceState;
  target: string;
  created: string;
  lastActivity: string;
  info?: {
    url?: string;
    providerMetadata?: Record<string, unknown>;
  };
}

/**
 * Daytona terminal backend implementation
 */
export class DaytonaTerminalBackend extends TerminalBackend {
  readonly id: string;
  readonly type = "daytona";
  readonly name: string;

  private daytonaConfig: DaytonaConfig;
  private workspace: DaytonaWorkspace | null = null;
  private apiBaseUrl: string;
  private headers: Record<string, string>;
  private currentDirectory = "/workspace";

  constructor(options: TerminalBackendOptions = {}) {
    super(options);

    const config = (options.config as any)?.daytona as DaytonaConfig | undefined;
    if (!config?.apiUrl || !config?.apiKey) {
      throw new Error("Daytona backend requires config.daytona.apiUrl and config.daytona.apiKey");
    }

    this.daytonaConfig = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey,
      workspaceId: config.workspaceId,
      workspaceName: config.workspaceName,
      target: config.target || "us",
      ide: config.ide || "vscode",
      autoCreate: config.autoCreate ?? true,
      autoPauseMinutes: config.autoPauseMinutes,
      autoStopMinutes: config.autoStopMinutes,
    };

    this.apiBaseUrl = this.daytonaConfig.apiUrl.replace(/\/$/, "");
    this.headers = {
      "Authorization": `Bearer ${this.daytonaConfig.apiKey}`,
      "Content-Type": "application/json",
    };

    this.id = `daytona-${this.daytonaConfig.workspaceId || "new"}`;
    this.name = `Daytona (${this.daytonaConfig.workspaceName || "workspace"})`;
  }

  // ─── Capabilities & Lifecycle ──────────────────────────────

  async getCapabilities(): Promise<TerminalCapabilities> {
    return {
      interactive: true,
      fileSystem: true,
      processManagement: true,
      environment: true,
      signals: false,
      maxCommandLength: 131072,
      supportedShells: ["sh", "bash", "zsh"],
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiBaseUrl}/api/workspace`, {
        headers: this.headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    // Check API availability
    if (!(await this.isAvailable())) {
      throw new Error("Daytona API is not available. Please check your API URL and key.");
    }

    // Get or create workspace
    if (this.daytonaConfig.workspaceId) {
      await this.getWorkspace(this.daytonaConfig.workspaceId);
    } else if (this.daytonaConfig.workspaceName) {
      await this.findOrCreateWorkspace();
    }

    // Ensure workspace is started
    if (this.workspace) {
      await this.ensureWorkspaceStarted();
    }

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    // Optionally pause or stop workspace based on config
    if (this.workspace && this.daytonaConfig.autoPauseMinutes === 0) {
      await this.stopWorkspace();
    }
    this.initialized = false;
  }

  // ─── Workspace Management ──────────────────────────────────

  private async apiRequest<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.apiBaseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.headers,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Daytona API error: ${response.status} - ${error}`);
    }

    return response.json() as Promise<T>;
  }

  private async getWorkspace(workspaceId: string): Promise<DaytonaWorkspace> {
    const workspace = await this.apiRequest<DaytonaWorkspace>(
      `/api/workspace/${workspaceId}`
    );
    this.workspace = workspace;
    return workspace;
  }

  private async findOrCreateWorkspace(): Promise<DaytonaWorkspace> {
    // List workspaces and find by name
    const workspaces = await this.apiRequest<DaytonaWorkspace[]>("/api/workspace");
    const existing = workspaces.find(
      (w) => w.name === this.daytonaConfig.workspaceName
    );

    if (existing) {
      this.workspace = existing;
      return existing;
    }

    // Create new workspace if autoCreate is enabled
    if (this.daytonaConfig.autoCreate) {
      return this.createWorkspace();
    }

    throw new Error(
      `Workspace "${this.daytonaConfig.workspaceName}" not found and autoCreate is disabled`
    );
  }

  private async createWorkspace(): Promise<DaytonaWorkspace> {
    const workspace = await this.apiRequest<DaytonaWorkspace>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({
        name: this.daytonaConfig.workspaceName,
        target: this.daytonaConfig.target,
        ide: this.daytonaConfig.ide,
      }),
    });

    this.workspace = workspace;

    // Wait for workspace to be ready
    await this.waitForWorkspaceState("started", 300000); // 5 minutes timeout

    return workspace;
  }

  private async waitForWorkspaceState(
    targetState: WorkspaceState,
    timeoutMs: number
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (!this.workspace) {
        throw new Error("No workspace to wait for");
      }

      const workspace = await this.getWorkspace(this.workspace.id);

      if (workspace.state === targetState) {
        return;
      }

      if (workspace.state === "error") {
        throw new Error("Workspace entered error state");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    throw new Error(`Timeout waiting for workspace to reach ${targetState} state`);
  }

  private async ensureWorkspaceStarted(): Promise<void> {
    if (!this.workspace) return;

    if (this.workspace.state === "stopped") {
      await this.startWorkspace();
    } else if (this.workspace.state !== "started") {
      await this.waitForWorkspaceState("started", 120000);
    }
  }

  async startWorkspace(): Promise<void> {
    if (!this.workspace) {
      throw new Error("No workspace to start");
    }

    await this.apiRequest(`/api/workspace/${this.workspace.id}/start`, {
      method: "POST",
    });

    await this.waitForWorkspaceState("started", 120000);
  }

  async stopWorkspace(): Promise<void> {
    if (!this.workspace) {
      throw new Error("No workspace to stop");
    }

    await this.apiRequest(`/api/workspace/${this.workspace.id}/stop`, {
      method: "POST",
    });

    this.workspace.state = "stopped";
  }

  async pauseWorkspace(): Promise<void> {
    // Daytona pause is similar to stop for billing purposes
    await this.stopWorkspace();
  }

  async resumeWorkspace(): Promise<void> {
    await this.startWorkspace();
  }

  async deleteWorkspace(): Promise<void> {
    if (!this.workspace) {
      throw new Error("No workspace to delete");
    }

    await this.apiRequest(`/api/workspace/${this.workspace.id}`, {
      method: "DELETE",
    });

    this.workspace = null;
  }

  // ─── Command Execution ─────────────────────────────────────

  protected async executeInternal(
    command: string,
    options: Required<TerminalExecuteOptions>
  ): Promise<TerminalExecuteResult> {
    await this.ensureWorkspaceStarted();

    if (!this.workspace) {
      throw new Error("No workspace available");
    }

    const startTime = Date.now();

    // Use Daytona exec API
    const result = await this.apiRequest<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command,
        cwd: options.cwd || this.currentDirectory,
        env: options.env,
        timeout: options.timeout,
      }),
    });

    const durationMs = Date.now() - startTime;

    let output = result.stdout || "";
    if (result.stderr) {
      output += `\n[stderr]\n${result.stderr}`;
    }

    output = this.truncateOutput(output, options.maxOutputSize);

    return {
      exitCode: result.exitCode,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      output,
      durationMs,
      timedOut: false,
      killed: false,
    };
  }

  protected async executeBackgroundInternal(
    command: string,
    options: Required<TerminalExecuteOptions>,
    taskId: string
  ): Promise<void> {
    await this.ensureWorkspaceStarted();

    if (!this.workspace) {
      throw new Error("No workspace available");
    }

    // Daytona doesn't have native background task support
    // We simulate it by running with nohup and polling for status
    const backgroundCommand = `nohup sh -c '${command.replace(/'/g, "'\\''")}' > /tmp/rookie_${taskId}.out 2>&1 & echo $!`;

    const result = await this.apiRequest<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: backgroundCommand,
        cwd: options.cwd || this.currentDirectory,
        env: options.env,
        timeout: 30000,
      }),
    });

    const pid = parseInt(result.stdout.trim(), 10);

    const task = this.backgroundTasks.get(taskId);
    if (task) {
      task.pid = pid;
    }

    // Start polling
    this.pollBackgroundTask(taskId);
  }

  private async pollBackgroundTask(taskId: string): Promise<void> {
    const task = this.backgroundTasks.get(taskId);
    if (!task || !this.workspace) return;

    const checkInterval = setInterval(async () => {
      try {
        const result = await this.apiRequest<{
          exitCode: number;
          stdout: string;
          stderr: string;
        }>(`/api/workspace/${this.workspace!.id}/exec`, {
          method: "POST",
          body: JSON.stringify({
            command: `ps -p ${task.pid} > /dev/null 2>&1 && echo "running" || echo "stopped"`,
            cwd: "/workspace",
            timeout: 10000,
          }),
        });

        if (result.stdout.includes("stopped")) {
          clearInterval(checkInterval);

          // Get output
          const outputResult = await this.apiRequest<{
            exitCode: number;
            stdout: string;
            stderr: string;
          }>(`/api/workspace/${this.workspace!.id}/exec`, {
            method: "POST",
            body: JSON.stringify({
              command: `cat /tmp/rookie_${taskId}.out 2>/dev/null || echo ""`,
              cwd: "/workspace",
              timeout: 10000,
            }),
          });

          task.status = "completed";
          task.endTime = Date.now();
          task.output = outputResult.stdout;
          task.errorOutput = outputResult.stderr;

          // Clean up
          this.apiRequest(`/api/workspace/${this.workspace!.id}/exec`, {
            method: "POST",
            body: JSON.stringify({
              command: `rm -f /tmp/rookie_${taskId}.out`,
              cwd: "/workspace",
              timeout: 5000,
            }),
          }).catch(() => {});

          this.emit("background:complete", { taskId });
        }
      } catch {
        clearInterval(checkInterval);
        task.status = "failed";
        task.endTime = Date.now();
        this.emit("background:error", { taskId });
      }
    }, 2000);

    // Stop polling after 1 hour
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 3600000);
  }

  async killProcess(pid: number): Promise<boolean> {
    if (!this.workspace) return false;

    try {
      await this.apiRequest(`/api/workspace/${this.workspace.id}/exec`, {
        method: "POST",
        body: JSON.stringify({
          command: `kill -9 ${pid}`,
          cwd: "/workspace",
          timeout: 5000,
        }),
      });
      return true;
    } catch {
      return false;
    }
  }

  // ─── File System Operations ────────────────────────────────

  async pathExists(filePath: string): Promise<boolean> {
    if (!this.workspace) return false;

    try {
      const result = await this.apiRequest<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>(`/api/workspace/${this.workspace.id}/exec`, {
        method: "POST",
        body: JSON.stringify({
          command: `test -e ${filePath} && echo "exists" || echo "not found"`,
          cwd: "/workspace",
          timeout: 5000,
        }),
      });

      return result.stdout.includes("exists");
    } catch {
      return false;
    }
  }

  async readFile(filePath: string, encoding: BufferEncoding = "utf8"): Promise<string | Buffer> {
    if (!this.workspace) {
      throw new Error("No workspace available");
    }

    const result = await this.apiRequest<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: `cat ${filePath}`,
        cwd: "/workspace",
        timeout: 30000,
      }),
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to read file: ${result.stderr}`);
    }

    return result.stdout;
  }

  async writeFile(
    filePath: string,
    content: string | Buffer,
    encoding: BufferEncoding = "utf8"
  ): Promise<void> {
    if (!this.workspace) {
      throw new Error("No workspace available");
    }

    const base64Content = Buffer.isBuffer(content)
      ? content.toString("base64")
      : Buffer.from(content, encoding).toString("base64");

    const result = await this.apiRequest<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: `echo "${base64Content}" | base64 -d > ${filePath}`,
        cwd: "/workspace",
        timeout: 30000,
      }),
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to write file: ${result.stderr}`);
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    if (!this.workspace) {
      throw new Error("No workspace available");
    }

    await this.apiRequest(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: `rm ${filePath}`,
        cwd: "/workspace",
        timeout: 10000,
      }),
    });
  }

  async createDirectory(dirPath: string, recursive = true): Promise<void> {
    if (!this.workspace) {
      throw new Error("No workspace available");
    }

    const flag = recursive ? "-p" : "";
    await this.apiRequest(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: `mkdir ${flag} ${dirPath}`,
        cwd: "/workspace",
        timeout: 10000,
      }),
    });
  }

  async deleteDirectory(dirPath: string, recursive = false): Promise<void> {
    if (!this.workspace) {
      throw new Error("No workspace available");
    }

    const flag = recursive ? "-rf" : "";
    await this.apiRequest(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: `rm ${flag} ${dirPath}`,
        cwd: "/workspace",
        timeout: 30000,
      }),
    });
  }

  async listDirectory(dirPath: string): Promise<FileSystemEntry[]> {
    if (!this.workspace) {
      throw new Error("No workspace available");
    }

    const result = await this.apiRequest<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: `ls -la ${dirPath}`,
        cwd: "/workspace",
        timeout: 10000,
      }),
    });

    const lines = result.stdout.split("\n").slice(1); // Skip total line
    const entries: FileSystemEntry[] = [];

    for (const line of lines) {
      const entry = this.parseFileEntry(line, dirPath);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  async getFileInfo(filePath: string): Promise<FileSystemEntry | null> {
    if (!this.workspace) {
      return null;
    }

    try {
      const result = await this.apiRequest<{
        exitCode: number;
        stdout: string;
        stderr: string;
      }>(`/api/workspace/${this.workspace.id}/exec`, {
        method: "POST",
        body: JSON.stringify({
          command: `ls -ld ${filePath}`,
          cwd: "/workspace",
          timeout: 5000,
        }),
      });

      return this.parseFileEntry(result.stdout, path.dirname(filePath));
    } catch {
      return null;
    }
  }

  // ─── Environment Operations ────────────────────────────────

  async setEnvironmentVariable(key: string, value: string): Promise<void> {
    // Daytona workspaces persist env vars in the container
    if (!this.workspace) return;

    await this.apiRequest(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: `echo "export ${key}=\\"${value}\\"" >> ~/.bashrc`,
        cwd: "/workspace",
        timeout: 5000,
      }),
    });
  }

  async getEnvironmentVariable(key: string): Promise<string | undefined> {
    if (!this.workspace) return undefined;

    const result = await this.apiRequest<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: `echo $${key}`,
        cwd: "/workspace",
        timeout: 5000,
      }),
    });

    const value = result.stdout.trim();
    return value || undefined;
  }

  async getEnvironmentVariables(): Promise<Record<string, string>> {
    if (!this.workspace) return {};

    const result = await this.apiRequest<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>(`/api/workspace/${this.workspace.id}/exec`, {
      method: "POST",
      body: JSON.stringify({
        command: "env",
        cwd: "/workspace",
        timeout: 10000,
      }),
    });

    const vars: Record<string, string> = {};
    for (const line of result.stdout.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        vars[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }
    return vars;
  }

  // ─── Path Operations ───────────────────────────────────────

  async resolvePath(filePath: string): Promise<string> {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.currentDirectory, filePath);
  }

  async getCurrentDirectory(): Promise<string> {
    return this.currentDirectory;
  }

  async changeDirectory(dirPath: string): Promise<void> {
    this.currentDirectory = await this.resolvePath(dirPath);
  }

  // ─── Daytona-Specific Features ─────────────────────────────

  /**
   * Get workspace info
   */
  async getWorkspaceInfo(): Promise<DaytonaWorkspace | null> {
    if (!this.workspace) return null;
    return this.getWorkspace(this.workspace.id);
  }

  /**
   * Get workspace URL for IDE access
   */
  async getWorkspaceUrl(): Promise<string | undefined> {
    if (!this.workspace?.info?.url) return undefined;
    return this.workspace.info.url;
  }

  /**
   * List all workspaces
   */
  async listWorkspaces(): Promise<DaytonaWorkspace[]> {
    return this.apiRequest<DaytonaWorkspace[]>("/api/workspace");
  }

  /**
   * Set auto-pause timeout
   */
  async setAutoPause(minutes: number): Promise<void> {
    if (!this.workspace) return;

    await this.apiRequest(`/api/workspace/${this.workspace.id}/auto-pause`, {
      method: "POST",
      body: JSON.stringify({ minutes }),
    });
  }

  /**
   * Get workspace logs
   */
  async getLogs(since?: Date, tail?: number): Promise<string> {
    if (!this.workspace) return "";

    const params = new URLSearchParams();
    if (since) params.append("since", since.toISOString());
    if (tail) params.append("tail", tail.toString());

    const response = await fetch(
      `${this.apiBaseUrl}/api/workspace/${this.workspace.id}/logs?${params}`,
      { headers: this.headers }
    );

    return response.text();
  }
}

// Register the backend
TerminalBackendRegistry.register("daytona", DaytonaTerminalBackend);
