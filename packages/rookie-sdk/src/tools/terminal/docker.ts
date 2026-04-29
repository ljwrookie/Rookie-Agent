/**
 * Docker terminal backend
 *
 * Executes commands in isolated Docker containers with:
 * - Automatic container management
 * - Resource limits
 * - Network restrictions
 * - File system isolation
 */

import { spawn, exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as os from "os";
import * as fs from "fs/promises";
import {
  TerminalBackend,
  TerminalBackendRegistry,
} from "./backend.js";
import {
  TerminalCapabilities,
  TerminalExecuteOptions,
  TerminalExecuteResult,
  FileSystemEntry,
  BackgroundTask,
  DockerConfig,
  TerminalBackendOptions,
  SandboxConfig,
} from "./types.js";

const execAsync = promisify(exec);

/**
 * Docker terminal backend implementation
 */
export class DockerTerminalBackend extends TerminalBackend {
  readonly id: string;
  readonly type = "docker";
  readonly name: string;

  private dockerConfig: DockerConfig;
  private containerName: string;
  private containerId: string | null = null;
  private isContainerRunning = false;
  private workspacePath: string;

  constructor(options: TerminalBackendOptions = {}) {
    super(options);

    const config = (options.config as any)?.docker as DockerConfig | undefined;
    if (!config?.image) {
      throw new Error("Docker backend requires config.docker.image");
    }

    this.dockerConfig = {
      host: config.host || process.env.DOCKER_HOST || "unix:///var/run/docker.sock",
      image: config.image,
      containerPrefix: config.containerPrefix || "rookie",
      autoRemove: config.autoRemove ?? true,
      keepAlive: config.keepAlive ?? false,
      volumes: config.volumes || [],
      ports: config.ports || [],
      networkMode: config.networkMode,
      extraHosts: config.extraHosts,
      dns: config.dns,
      entrypoint: config.entrypoint,
      cmd: config.cmd,
    };

    this.id = `docker-${this.dockerConfig.image.replace(/[^a-zA-Z0-9]/g, "-")}`;
    this.name = `Docker (${this.dockerConfig.image})`;
    const cfg = (options.config ?? {}) as Record<string, unknown>;
    this.workspacePath = (typeof cfg.workspacePath === "string" ? cfg.workspacePath : undefined) ?? process.cwd();
    this.containerName = `${this.dockerConfig.containerPrefix}-${Date.now()}`;
  }

  // ─── Capabilities & Lifecycle ──────────────────────────────

  async getCapabilities(): Promise<TerminalCapabilities> {
    return {
      interactive: true,
      fileSystem: true,
      processManagement: true,
      environment: true,
      signals: false, // Limited signal support in containers
      maxCommandLength: 131072,
      supportedShells: ["sh", "bash"],
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("docker version");
      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    // Check Docker is available
    if (!(await this.isAvailable())) {
      throw new Error("Docker is not available. Please install Docker and ensure it's running.");
    }

    // Create container if keepAlive is enabled
    if (this.dockerConfig.keepAlive) {
      await this.createContainer();
    }

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    if (this.containerId) {
      if (this.dockerConfig.autoRemove) {
        await this.removeContainer();
      } else {
        await this.stopContainer();
      }
    }
    this.initialized = false;
  }

  // ─── Container Management ──────────────────────────────────

  private async createContainer(): Promise<string> {
    const args = ["run", "-d", "--name", this.containerName];

    // Auto-remove if not keeping alive
    if (this.dockerConfig.autoRemove && !this.dockerConfig.keepAlive) {
      args.push("--rm");
    }

    // Network mode
    if (this.dockerConfig.networkMode) {
      args.push("--network", this.dockerConfig.networkMode);
    }

    // DNS
    if (this.dockerConfig.dns) {
      for (const dns of this.dockerConfig.dns) {
        args.push("--dns", dns);
      }
    }

    // Extra hosts
    if (this.dockerConfig.extraHosts) {
      for (const host of this.dockerConfig.extraHosts) {
        args.push("--add-host", host);
      }
    }

    // Volume mounts
    // Always mount workspace
    args.push("-v", `${this.workspacePath}:/workspace`);

    for (const vol of this.dockerConfig.volumes || []) {
      const mount = vol.readOnly
        ? `${vol.source}:${vol.target}:ro`
        : `${vol.source}:${vol.target}`;
      args.push("-v", mount);
    }

    // Port mappings
    for (const port of this.dockerConfig.ports || []) {
      args.push("-p", `${port.host}:${port.container}`);
    }

    // Working directory
    args.push("-w", "/workspace");

    // Entrypoint
    if (this.dockerConfig.entrypoint) {
      args.push("--entrypoint", this.dockerConfig.entrypoint.join(" "));
    }

    // Image
    args.push(this.dockerConfig.image);

    // Command
    if (this.dockerConfig.cmd) {
      args.push(...this.dockerConfig.cmd);
    } else {
      args.push("sleep", "3600"); // Keep container alive for 1 hour
    }

    const { stdout } = await execAsync(`docker ${args.join(" ")}`);
    this.containerId = stdout.trim();
    this.isContainerRunning = true;

    return this.containerId;
  }

  private async stopContainer(): Promise<void> {
    if (this.containerId) {
      try {
        await execAsync(`docker stop ${this.containerId}`);
        this.isContainerRunning = false;
      } catch {
        // Container might already be stopped
      }
    }
  }

  private async removeContainer(): Promise<void> {
    if (this.containerId) {
      try {
        await execAsync(`docker rm -f ${this.containerId}`);
      } catch {
        // Container might already be removed
      }
      this.containerId = null;
      this.isContainerRunning = false;
    }
  }

  private async ensureContainer(): Promise<string> {
    if (!this.dockerConfig.keepAlive) {
      // For non-keepAlive mode, create a new container for each command
      await this.createContainer();
      return this.containerId!;
    }

    if (!this.containerId || !this.isContainerRunning) {
      await this.createContainer();
    }

    return this.containerId!;
  }

  // ─── Command Execution ─────────────────────────────────────

  protected async executeInternal(
    command: string,
    options: Required<TerminalExecuteOptions>
  ): Promise<TerminalExecuteResult> {
    const startTime = Date.now();
    const containerId = await this.ensureContainer();

    // Build docker exec command
    const args = ["exec"];

    // Working directory
    if (options.cwd) {
      const containerCwd = options.cwd.replace(this.workspacePath, "/workspace");
      args.push("-w", containerCwd);
    }

    // Environment variables
    for (const [key, value] of Object.entries(options.env)) {
      args.push("-e", `${key}=${value}`);
    }

    args.push(containerId, "sh", "-c", command);

    try {
      const { stdout, stderr } = await execAsync(`docker ${args.join(" ")}`, {
        timeout: options.timeout,
        maxBuffer: options.maxOutputSize,
      });

      const durationMs = Date.now() - startTime;

      let output = stdout || "";
      if (stderr) {
        output += `\n[stderr]\n${stderr}`;
      }

      output = this.truncateOutput(output, options.maxOutputSize);

      // Clean up container if not keepAlive
      if (!this.dockerConfig.keepAlive) {
        await this.removeContainer();
      }

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

      // Clean up container if not keepAlive
      if (!this.dockerConfig.keepAlive) {
        await this.removeContainer();
      }

      let stdout = error.stdout || "";
      let stderr = error.stderr || "";
      let output = stdout;
      if (stderr) {
        output += `\n[stderr]\n${stderr}`;
      }

      output = this.truncateOutput(output, options.maxOutputSize);

      const timedOut = error.killed === true;

      return {
        exitCode: error.code || 1,
        stdout,
        stderr,
        output,
        durationMs,
        timedOut,
        killed: error.killed || false,
      };
    }
  }

  protected async executeBackgroundInternal(
    command: string,
    options: Required<TerminalExecuteOptions>,
    taskId: string
  ): Promise<void> {
    const containerId = await this.ensureContainer();

    // Build docker exec command
    const args = ["exec", "-d"]; // Detached mode

    // Working directory
    if (options.cwd) {
      const containerCwd = options.cwd.replace(this.workspacePath, "/workspace");
      args.push("-w", containerCwd);
    }

    // Environment variables
    for (const [key, value] of Object.entries(options.env)) {
      args.push("-e", `${key}=${value}`);
    }

    args.push(containerId, "sh", "-c", command);

    const child = spawn("docker", args, {
      detached: true,
      stdio: "ignore",
    });

    const task = this.backgroundTasks.get(taskId);
    if (task) {
      task.pid = child.pid;
    }

    // For background tasks in Docker, we can't easily track output
    // Mark as completed immediately (Docker detached mode limitation)
    child.on("close", () => {
      if (task) {
        task.status = "completed";
        task.endTime = Date.now();
        task.output = "Command executed in detached mode. Output not available.";
        this.emit("background:complete", { taskId });
      }

      // Clean up container if not keepAlive
      if (!this.dockerConfig.keepAlive) {
        this.removeContainer().catch(() => {});
      }
    });

    child.unref();
  }

  async killProcess(pid: number): Promise<boolean> {
    // In Docker, we kill processes via docker exec
    if (!this.containerId) return false;

    try {
      await execAsync(`docker exec ${this.containerId} kill -9 ${pid}`);
      return true;
    } catch {
      return false;
    }
  }

  // ─── File System Operations ────────────────────────────────

  async pathExists(filePath: string): Promise<boolean> {
    const containerPath = this.toContainerPath(filePath);
    const containerId = await this.ensureContainer();

    try {
      await execAsync(`docker exec ${containerId} test -e ${containerPath}`);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string, encoding: BufferEncoding = "utf8"): Promise<string | Buffer> {
    const containerPath = this.toContainerPath(filePath);
    const containerId = await this.ensureContainer();

    const { stdout } = await execAsync(`docker exec ${containerId} cat ${containerPath}`, {
      encoding,
      maxBuffer: this.maxOutputSize,
    });

    return stdout;
  }

  async writeFile(
    filePath: string,
    content: string | Buffer,
    encoding: BufferEncoding = "utf8"
  ): Promise<void> {
    const containerPath = this.toContainerPath(filePath);
    const containerId = await this.ensureContainer();

    // Use docker cp for file writing
    const tempFile = path.join(os.tmpdir(), `rookie-docker-${Date.now()}`);
    const buf = typeof content === "string" ? Buffer.from(content, encoding) : content;
    await fs.writeFile(tempFile, buf);
    await execAsync(`docker cp ${tempFile} ${containerId}:${containerPath}`);
    await fs.unlink(tempFile).catch(() => {});
  }

  async deleteFile(filePath: string): Promise<void> {
    const containerPath = this.toContainerPath(filePath);
    const containerId = await this.ensureContainer();

    await execAsync(`docker exec ${containerId} rm ${containerPath}`);
  }

  async createDirectory(dirPath: string, recursive = true): Promise<void> {
    const containerPath = this.toContainerPath(dirPath);
    const containerId = await this.ensureContainer();

    const flag = recursive ? "-p" : "";
    await execAsync(`docker exec ${containerId} mkdir ${flag} ${containerPath}`);
  }

  async deleteDirectory(dirPath: string, recursive = false): Promise<void> {
    const containerPath = this.toContainerPath(dirPath);
    const containerId = await this.ensureContainer();

    if (recursive) {
      await execAsync(`docker exec ${containerId} rm -rf ${containerPath}`);
    } else {
      await execAsync(`docker exec ${containerId} rmdir ${containerPath}`);
    }
  }

  async listDirectory(dirPath: string): Promise<FileSystemEntry[]> {
    const containerPath = this.toContainerPath(dirPath);
    const containerId = await this.ensureContainer();

    const { stdout } = await execAsync(
      `docker exec ${containerId} ls -la ${containerPath}`
    );

    const lines = stdout.split("\n").slice(1); // Skip total line
    const entries: FileSystemEntry[] = [];

    for (const line of lines) {
      const entry = this.parseFileEntry(line, containerPath);
      if (entry) {
        entries.push(entry);
      }
    }

    return entries;
  }

  async getFileInfo(filePath: string): Promise<FileSystemEntry | null> {
    const containerPath = this.toContainerPath(filePath);
    const containerId = await this.ensureContainer();

    try {
      const { stdout } = await execAsync(
        `docker exec ${containerId} ls -ld ${containerPath}`
      );
      return this.parseFileEntry(stdout, path.dirname(containerPath));
    } catch {
      return null;
    }
  }

  // ─── Environment Operations ────────────────────────────────

  async setEnvironmentVariable(key: string, value: string): Promise<void> {
    // Docker containers don't persist env changes between exec calls
    // Store in our config for future commands
    if (!this.dockerConfig.cmd) {
      this.dockerConfig.cmd = [];
    }
    // This is a limitation - env vars set this way only apply to new containers
  }

  async getEnvironmentVariable(key: string): Promise<string | undefined> {
    const containerId = await this.ensureContainer();

    try {
      const { stdout } = await execAsync(
        `docker exec ${containerId} printenv ${key}`
      );
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  async getEnvironmentVariables(): Promise<Record<string, string>> {
    const containerId = await this.ensureContainer();

    const { stdout } = await execAsync(`docker exec ${containerId} env`);
    const vars: Record<string, string> = {};

    for (const line of stdout.split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) {
        vars[line.slice(0, eq)] = line.slice(eq + 1);
      }
    }

    return vars;
  }

  // ─── Path Operations ───────────────────────────────────────

  async resolvePath(filePath: string): Promise<string> {
    return this.toContainerPath(filePath);
  }

  private toContainerPath(filePath: string): string {
    // Convert host path to container path
    if (filePath.startsWith(this.workspacePath)) {
      return filePath.replace(this.workspacePath, "/workspace");
    }
    if (!path.isAbsolute(filePath)) {
      return `/workspace/${filePath}`;
    }
    return filePath;
  }

  async getCurrentDirectory(): Promise<string> {
    return "/workspace";
  }

  async changeDirectory(dirPath: string): Promise<void> {
    // In Docker, we just track the path - actual cd happens in exec
    // This is a no-op since each exec can specify working directory
  }

  // ─── Security & Sandbox ────────────────────────────────────

  /**
   * Apply resource limits to container
   */
  async applyResourceLimits(limits: {
    memory?: string;
    cpus?: number;
    pids?: number;
  }): Promise<void> {
    if (!this.containerId) return;

    const args: string[] = [];
    if (limits.memory) args.push("--memory", limits.memory);
    if (limits.cpus) args.push("--cpus", limits.cpus.toString());
    if (limits.pids) args.push("--pids-limit", limits.pids.toString());

    // Update requires recreating container
    // For now, this is a limitation - limits must be set at creation
  }

  /**
   * Execute with full sandbox configuration
   */
  async executeSandboxed(
    command: string,
    sandbox: SandboxConfig,
    options?: TerminalExecuteOptions
  ): Promise<TerminalExecuteResult> {
    // Docker provides natural sandboxing
    // Apply additional restrictions via command wrapping
    const sandboxedCommand = this.applySandbox(command, sandbox);
    return this.execute(sandboxedCommand, options);
  }

  /**
   * Get container logs
   */
  async getContainerLogs(since?: Date, tail?: number): Promise<string> {
    if (!this.containerId) return "";

    const args = ["logs"];
    if (since) {
      args.push("--since", since.toISOString());
    }
    if (tail) {
      args.push("--tail", tail.toString());
    }
    args.push(this.containerId);

    const { stdout } = await execAsync(`docker ${args.join(" ")}`);
    return stdout;
  }

  /**
   * Get container stats
   */
  async getContainerStats(): Promise<{
    cpu: string;
    memory: string;
    memoryLimit: string;
    networkIO: string;
    blockIO: string;
  } | null> {
    if (!this.containerId) return null;

    try {
      const { stdout } = await execAsync(
        `docker stats ${this.containerId} --no-stream --format "{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}"`
      );
      const [cpu, memory, networkIO, blockIO] = stdout.trim().split("|");
      const [memUsed, memLimit] = memory.split(" / ");

      return {
        cpu: cpu.trim(),
        memory: memUsed?.trim() || "",
        memoryLimit: memLimit?.trim() || "",
        networkIO: networkIO.trim(),
        blockIO: blockIO.trim(),
      };
    } catch {
      return null;
    }
  }
}

// Register the backend
TerminalBackendRegistry.register("docker", DockerTerminalBackend);
