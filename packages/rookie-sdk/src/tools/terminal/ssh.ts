/**
 * SSH terminal backend
 *
 * Executes commands on remote hosts via SSH with:
 * - Connection pooling
 * - Automatic reconnection
 * - SFTP file operations
 * - Jump host (bastion) support
 */

// Optional dependency: only needed when SSH backend is used.
// Keep this module type-safe without requiring ssh2 in all installs.
import { createRequire } from "node:module";

type Client = any;
type SFTPWrapper = any;
type ConnectConfig = any;

const require = createRequire(import.meta.url);
const { Client: SshClient } = require("ssh2") as any;
import * as fs from "fs";
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
  BackgroundTask,
  SSHConfig,
  TerminalBackendOptions,
} from "./types.js";

/**
 * SSH connection pool entry
 */
interface PooledConnection {
  client: Client;
  sftp: SFTPWrapper | null;
  lastUsed: number;
  inUse: boolean;
  id: string;
}

/**
 * SSH terminal backend implementation
 */
export class SSHTerminalBackend extends TerminalBackend {
  readonly id: string;
  readonly type = "ssh";
  readonly name: string;

  private sshConfig: SSHConfig;
  private connectionPool: PooledConnection[] = [];
  private maxPoolSize = 5;
  private reconnectAttempts = 3;
  private reconnectDelay = 1000;
  private currentDirectory = ".";
  private environmentVariables = new Map<string, string>();

  // Connection state
  private mainConnection: Client | null = null;
  private isConnected = false;
  private connectionPromise: Promise<void> | null = null;

  constructor(options: TerminalBackendOptions = {}) {
    super(options);

    const config = (options.config as any)?.ssh as SSHConfig | undefined;
    if (!config?.host || !config?.username) {
      throw new Error("SSH backend requires config.ssh.host and config.ssh.username");
    }

    this.sshConfig = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      auth: config.auth,
      connectTimeout: config.connectTimeout || 30000,
      keepaliveInterval: config.keepaliveInterval || 60000,
      maxReconnectAttempts: config.maxReconnectAttempts || 3,
      reconnectDelay: config.reconnectDelay || 1000,
      compress: config.compress ?? true,
      knownHostsPath: config.knownHostsPath,
      strictHostKeyChecking: config.strictHostKeyChecking ?? true,
      jumpHost: config.jumpHost,
    };

    this.id = `ssh-${this.sshConfig.host}-${this.sshConfig.username}`;
    this.name = `SSH (${this.sshConfig.host})`;
    this.reconnectAttempts = this.sshConfig.maxReconnectAttempts ?? 3;
    this.reconnectDelay = this.sshConfig.reconnectDelay ?? 1000;
  }

  // ─── Capabilities & Lifecycle ──────────────────────────────

  async getCapabilities(): Promise<TerminalCapabilities> {
    return {
      interactive: true,
      fileSystem: true,
      processManagement: true,
      environment: true,
      signals: true,
      maxCommandLength: 131072,
      supportedShells: ["sh", "bash", "zsh"],
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.connect();
      return true;
    } catch {
      return false;
    }
  }

  async initialize(): Promise<void> {
    await this.connect();
    this.initialized = true;
  }

  async dispose(): Promise<void> {
    // Close all pooled connections
    for (const conn of this.connectionPool) {
      conn.client.end();
    }
    this.connectionPool = [];

    // Close main connection
    if (this.mainConnection) {
      this.mainConnection.end();
      this.mainConnection = null;
    }

    this.isConnected = false;
    this.initialized = false;
  }

  // ─── Connection Management ─────────────────────────────────

  private async connect(): Promise<void> {
    if (this.isConnected && this.mainConnection) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this.doConnect();
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async doConnect(attempt = 1): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = new SshClient();

      client.on("ready", () => {
        this.mainConnection = client;
        this.isConnected = true;
        resolve();
      });

      client.on("error", (err: any) => {
        if (attempt < this.reconnectAttempts) {
          setTimeout(() => {
            this.doConnect(attempt + 1).then(resolve).catch(reject);
          }, this.reconnectDelay * attempt);
        } else {
          reject(err);
        }
      });

      client.on("close", () => {
        this.isConnected = false;
        this.mainConnection = null;
      });

      client.on("end", () => {
        this.isConnected = false;
        this.mainConnection = null;
      });

      const connectConfig = this.buildConnectConfig();
      client.connect(connectConfig);
    });
  }

  private buildConnectConfig(): ConnectConfig {
    const config: ConnectConfig = {
      host: this.sshConfig.host,
      port: this.sshConfig.port,
      username: this.sshConfig.username,
      readyTimeout: this.sshConfig.connectTimeout,
      keepaliveInterval: this.sshConfig.keepaliveInterval,
      compress: this.sshConfig.compress,
    };

    // Authentication
    switch (this.sshConfig.auth.type) {
      case "password":
        config.password = this.sshConfig.auth.password;
        break;
      case "privateKey":
        if (this.sshConfig.auth.privateKey) {
          config.privateKey = this.sshConfig.auth.privateKey;
        } else if (this.sshConfig.auth.privateKeyPath) {
          config.privateKey = fs.readFileSync(this.sshConfig.auth.privateKeyPath);
        }
        if (this.sshConfig.auth.passphrase) {
          config.passphrase = this.sshConfig.auth.passphrase;
        }
        break;
      case "agent":
        config.agent = process.env.SSH_AUTH_SOCK;
        break;
    }

    // Jump host (bastion) support
    if (this.sshConfig.jumpHost) {
      // TODO: Implement jump host support
      // This requires establishing a connection through the bastion first
    }

    return config;
  }

  private async getConnection(): Promise<Client> {
    await this.connect();

    // Try to find an available pooled connection
    const available = this.connectionPool.find((c) => !c.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available.client;
    }

    // Create new connection if pool not full
    if (this.connectionPool.length < this.maxPoolSize) {
      const client = await this.createPooledConnection();
      return client;
    }

    // Wait for a connection to become available
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const conn = this.connectionPool.find((c) => !c.inUse);
        if (conn) {
          clearInterval(checkInterval);
          conn.inUse = true;
          conn.lastUsed = Date.now();
          resolve(conn.client);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error("Connection pool timeout"));
      }, 30000);
    });
  }

  private async createPooledConnection(): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new SshClient();
      const connId = `conn_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      client.on("ready", () => {
        const pooledConn: PooledConnection = {
          client,
          sftp: null,
          lastUsed: Date.now(),
          inUse: true,
          id: connId,
        };
        this.connectionPool.push(pooledConn);
        resolve(client);
      });

      client.on("error", reject as any);
      client.on("close", () => {
        const idx = this.connectionPool.findIndex((c) => c.id === connId);
        if (idx !== -1) {
          this.connectionPool.splice(idx, 1);
        }
      });

      client.connect(this.buildConnectConfig());
    });
  }

  private releaseConnection(client: Client): void {
    const conn = this.connectionPool.find((c) => c.client === client);
    if (conn) {
      conn.inUse = false;
      conn.lastUsed = Date.now();
    }
  }

  private async getSFTP(): Promise<SFTPWrapper> {
    // Try to get SFTP from main connection first
    if (this.mainConnection) {
      return new Promise((resolve, reject) => {
        this.mainConnection!.sftp((err: any, sftp: any) => {
          if (err) reject(err);
          else resolve(sftp);
        });
      });
    }

    throw new Error("Not connected");
  }

  // ─── Command Execution ─────────────────────────────────────

  protected async executeInternal(
    command: string,
    options: Required<TerminalExecuteOptions>
  ): Promise<TerminalExecuteResult> {
    const startTime = Date.now();
    const client = await this.getConnection();

    try {
      const result = await this.execCommand(client, command, options);
      this.releaseConnection(client);
      return result;
    } catch (error) {
      this.releaseConnection(client);
      throw error;
    }
  }

  private execCommand(
    client: Client,
    command: string,
    options: Required<TerminalExecuteOptions>
  ): Promise<TerminalExecuteResult> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      // Build environment setup
      const envSetup = Object.entries(options.env)
        .map(([k, v]) => `export ${k}="${v}"`)
        .join(" && ");

      // Build full command
      let fullCommand = command;
      if (envSetup) {
        fullCommand = `${envSetup} && ${command}`;
      }
      if (options.cwd) {
        fullCommand = `cd ${options.cwd} && ${fullCommand}`;
      }

      client.exec(fullCommand, (err: any, stream: any) => {
        if (err) {
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";
        let exitCode: number | null = null;
        let timedOut = false;

        // Set up timeout
        const timeoutId = setTimeout(() => {
          timedOut = true;
          stream.close();
        }, options.timeout);

        stream.on("close", (code: number, signal: string) => {
          clearTimeout(timeoutId);
          const durationMs = Date.now() - startTime;

          let output = stdout;
          if (stderr) {
            output += `\n[stderr]\n${stderr}`;
          }

          output = this.truncateOutput(output, options.maxOutputSize);

          if (timedOut) {
            output += `\n[ERROR] Command timed out after ${options.timeout}ms`;
          }

          resolve({
            exitCode: code ?? null,
            stdout,
            stderr,
            output,
            durationMs,
            timedOut,
            killed: signal !== undefined,
          });
        });

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on("error", (err: Error) => {
          clearTimeout(timeoutId);
          reject(err);
        });
      });
    });
  }

  protected async executeBackgroundInternal(
    command: string,
    options: Required<TerminalExecuteOptions>,
    taskId: string
  ): Promise<void> {
    const client = await this.getConnection();

    // Build command with nohup for background execution
    const envSetup = Object.entries(options.env)
      .map(([k, v]) => `export ${k}="${v}"`)
      .join(" && ");

    let fullCommand = `nohup sh -c '${command.replace(/'/g, "'\\''")}' > /tmp/rookie_${taskId}.out 2>&1 & echo $!`;
    if (envSetup) {
      fullCommand = `${envSetup} && ${fullCommand}`;
    }
    if (options.cwd) {
      fullCommand = `cd ${options.cwd} && ${fullCommand}`;
    }

    return new Promise((resolve, reject) => {
      client.exec(fullCommand, (err: any, stream: any) => {
        if (err) {
          this.releaseConnection(client);
          reject(err);
          return;
        }

        let pid = "";
        stream.on("data", (data: Buffer) => {
          pid += data.toString().trim();
        });

        stream.on("close", () => {
          this.releaseConnection(client);

          const task = this.backgroundTasks.get(taskId);
          if (task) {
            task.pid = parseInt(pid, 10);
          }

          // Start polling for task completion
          this.pollBackgroundTask(taskId, client);

          resolve();
        });

        stream.on("error", (err: Error) => {
          this.releaseConnection(client);
          reject(err);
        });
      });
    });
  }

  private async pollBackgroundTask(taskId: string, client: Client): Promise<void> {
    const task = this.backgroundTasks.get(taskId);
    if (!task || !task.pid) return;

    const checkInterval = setInterval(async () => {
      try {
        const { stdout } = await this.execCommand(
          client,
          `ps -p ${task.pid} > /dev/null 2>&1 && echo "running" || echo "stopped"`,
          {
            cwd: ".",
            env: {},
            timeout: 5000,
            maxOutputSize: 1024,
            background: false,
            timeoutSignal: "SIGTERM",
          }
        );

        if (stdout.includes("stopped")) {
          clearInterval(checkInterval);

          // Get output
          const outputResult = await this.execCommand(
            client,
            `cat /tmp/rookie_${taskId}.out 2>/dev/null || echo ""`,
            {
              cwd: ".",
              env: {},
              timeout: 5000,
              maxOutputSize: this.maxOutputSize,
              background: false,
              timeoutSignal: "SIGTERM",
            }
          );

          task.status = "completed";
          task.endTime = Date.now();
          task.output = outputResult.stdout;
          task.errorOutput = outputResult.stderr;

          // Clean up temp file
          this.execCommand(client, `rm -f /tmp/rookie_${taskId}.out`, {
            cwd: ".",
            env: {},
            timeout: 5000,
            maxOutputSize: 1024,
            background: false,
            timeoutSignal: "SIGTERM",
          }).catch(() => {});

          this.emit("background:complete", { taskId });
        }
      } catch {
        clearInterval(checkInterval);
        task.status = "failed";
        task.endTime = Date.now();
        this.emit("background:error", { taskId });
      }
    }, 1000);

    // Stop polling after timeout
    setTimeout(() => {
      clearInterval(checkInterval);
    }, 3600000); // 1 hour max
  }

  async killProcess(pid: number, signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<boolean> {
    const client = await this.getConnection();
    try {
      await this.execCommand(client, `kill -${signal} ${pid}`, {
        cwd: ".",
        env: {},
        timeout: 5000,
        maxOutputSize: 1024,
        background: false,
        timeoutSignal: "SIGTERM",
      });
      return true;
    } catch {
      return false;
    } finally {
      this.releaseConnection(client);
    }
  }

  // ─── File System Operations (SFTP) ─────────────────────────

  async pathExists(filePath: string): Promise<boolean> {
    const sftp = await this.getSFTP();
    return new Promise((resolve) => {
      sftp.stat(filePath, (err: any) => {
        resolve(!err);
      });
    });
  }

  async readFile(filePath: string, encoding: BufferEncoding = "utf8"): Promise<string | Buffer> {
    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(filePath);

      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => {
        const buffer = Buffer.concat(chunks);
        resolve(encoding ? buffer.toString(encoding) : buffer);
      });
      stream.on("error", reject);
    });
  }

  async writeFile(
    filePath: string,
    content: string | Buffer,
    encoding: BufferEncoding = "utf8"
  ): Promise<void> {
    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
      const stream = sftp.createWriteStream(filePath);

      stream.on("close", resolve);
      stream.on("error", reject);
      stream.end(buffer);
    });
  }

  async deleteFile(filePath: string): Promise<void> {
    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      sftp.unlink(filePath, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async createDirectory(dirPath: string, recursive = true): Promise<void> {
    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      if (recursive) {
        // Use mkdir -p equivalent
        this.execCommand(this.mainConnection!, `mkdir -p ${dirPath}`, {
          cwd: ".",
          env: {},
          timeout: 10000,
          maxOutputSize: 1024,
          background: false,
          timeoutSignal: "SIGTERM",
        })
          .then(() => resolve())
          .catch(reject);
      } else {
        sftp.mkdir(dirPath, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });
  }

  async deleteDirectory(dirPath: string, recursive = false): Promise<void> {
    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      if (recursive) {
        this.execCommand(this.mainConnection!, `rm -rf ${dirPath}`, {
          cwd: ".",
          env: {},
          timeout: 30000,
          maxOutputSize: 1024,
          background: false,
          timeoutSignal: "SIGTERM",
        })
          .then(() => resolve())
          .catch(reject);
      } else {
        sftp.rmdir(dirPath, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });
  }

  async listDirectory(dirPath: string): Promise<FileSystemEntry[]> {
    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      sftp.readdir(dirPath, (err: any, list: any[]) => {
        if (err) {
          reject(err);
          return;
        }

        const entries: FileSystemEntry[] = list.map((item) => ({
          name: item.filename,
          path: path.join(dirPath, item.filename),
          type: item.attrs.isDirectory() ? "directory" : item.attrs.isSymbolicLink() ? "symlink" : "file",
          size: item.attrs.size,
          modifiedAt: item.attrs.mtime * 1000,
          permissions: item.attrs.mode?.toString(8).slice(-3),
        }));

        resolve(entries);
      });
    });
  }

  async getFileInfo(filePath: string): Promise<FileSystemEntry | null> {
    const sftp = await this.getSFTP();
    return new Promise((resolve) => {
      sftp.stat(filePath, (err: any, stats: any) => {
        if (err) {
          resolve(null);
          return;
        }

        resolve({
          name: path.basename(filePath),
          path: filePath,
          type: stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "symlink" : "file",
          size: stats.size,
          modifiedAt: stats.mtime * 1000,
          permissions: stats.mode?.toString(8).slice(-3),
        });
      });
    });
  }

  // ─── Environment Operations ────────────────────────────────

  async setEnvironmentVariable(key: string, value: string): Promise<void> {
    this.environmentVariables.set(key, value);
  }

  async getEnvironmentVariable(key: string): Promise<string | undefined> {
    const client = await this.getConnection();
    try {
      const result = await this.execCommand(client, `echo $${key}`, {
        cwd: ".",
        env: {},
        timeout: 5000,
        maxOutputSize: 1024,
        background: false,
        timeoutSignal: "SIGTERM",
      });
      const value = result.stdout.trim();
      return value || undefined;
    } finally {
      this.releaseConnection(client);
    }
  }

  async getEnvironmentVariables(): Promise<Record<string, string>> {
    const client = await this.getConnection();
    try {
      const result = await this.execCommand(client, "env", {
        cwd: ".",
        env: {},
        timeout: 5000,
        maxOutputSize: 65536,
        background: false,
        timeoutSignal: "SIGTERM",
      });

      const vars: Record<string, string> = {};
      for (const line of result.stdout.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > 0) {
          vars[line.slice(0, eq)] = line.slice(eq + 1);
        }
      }
      return vars;
    } finally {
      this.releaseConnection(client);
    }
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

  // ─── Additional SSH Features ───────────────────────────────

  /**
   * Upload a file via SFTP
   */
  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Download a file via SFTP
   */
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const sftp = await this.getSFTP();
    return new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Forward a local port to a remote port
   */
  async forwardPort(localPort: number, remoteHost: string, remotePort: number): Promise<void> {
    await this.connect();
    this.mainConnection!.forwardIn("localhost", localPort, (err: any) => {
      if (err) {
        throw err;
      }
    });
  }
}

// Register the backend
TerminalBackendRegistry.register("ssh", SSHTerminalBackend);
