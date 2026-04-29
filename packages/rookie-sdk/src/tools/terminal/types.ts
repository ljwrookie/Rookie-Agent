/**
 * Terminal backend types and interfaces
 */

/**
 * Terminal execution options
 */
export interface TerminalExecuteOptions {
  /** Working directory */
  cwd?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Maximum output size in bytes */
  maxOutputSize?: number;
  /** Run in background */
  background?: boolean;
  /** Signal to send on timeout */
  timeoutSignal?: "SIGTERM" | "SIGKILL";
}

/**
 * Terminal execution result
 */
export interface TerminalExecuteResult {
  /** Exit code (null if timed out or killed) */
  exitCode: number | null;
  /** Standard output */
  stdout: string;
  /** Standard error */
  stderr: string;
  /** Combined output (stdout + stderr) */
  output: string;
  /** Execution duration in milliseconds */
  durationMs: number;
  /** Whether the command timed out */
  timedOut: boolean;
  /** Whether the command was killed */
  killed: boolean;
}

/**
 * Background task status
 */
export type BackgroundTaskStatus = "running" | "completed" | "failed" | "cancelled";

/**
 * Background task information
 */
export interface BackgroundTask {
  /** Task ID */
  id: string;
  /** Command being executed */
  command: string;
  /** Current status */
  status: BackgroundTaskStatus;
  /** Start timestamp */
  startTime: number;
  /** End timestamp (if completed) */
  endTime?: number;
  /** Exit code (if completed) */
  exitCode?: number;
  /** Current output */
  output: string;
  /** Error output */
  errorOutput: string;
  /** Process ID (if available) */
  pid?: number;
}

/**
 * File system entry info
 */
export interface FileSystemEntry {
  /** Entry name */
  name: string;
  /** Full path */
  path: string;
  /** Entry type */
  type: "file" | "directory" | "symlink" | "other";
  /** File size in bytes */
  size: number;
  /** Last modified timestamp */
  modifiedAt: number;
  /** Permissions string (e.g., "rwxr-xr-x") */
  permissions?: string;
}

/**
 * Terminal capabilities
 */
export interface TerminalCapabilities {
  /** Supports interactive shell */
  interactive: boolean;
  /** Supports file system operations */
  fileSystem: boolean;
  /** Supports process management */
  processManagement: boolean;
  /** Supports environment variables */
  environment: boolean;
  /** Supports signal sending */
  signals: boolean;
  /** Maximum command length */
  maxCommandLength?: number;
  /** Supported shells */
  supportedShells?: string[];
}

/**
 * Resource limits for sandboxed execution
 */
export interface ResourceLimits {
  /** Maximum CPU time in seconds */
  cpuTime?: number;
  /** Maximum memory in bytes */
  memory?: number;
  /** Maximum number of processes */
  processes?: number;
  /** Maximum file size in bytes */
  fileSize?: number;
  /** Maximum number of open files */
  openFiles?: number;
  /** Maximum stack size in bytes */
  stackSize?: number;
}

/**
 * Network configuration for sandboxed execution
 */
export interface NetworkConfig {
  /** Allow outbound connections */
  allowOutbound?: boolean;
  /** Allowed domains */
  allowedDomains?: string[];
  /** Blocked domains */
  blockedDomains?: string[];
  /** Allowed ports */
  allowedPorts?: number[];
  /** DNS servers */
  dnsServers?: string[];
}

/**
 * File system restrictions for sandboxed execution
 */
export interface FileSystemRestrictions {
  /** Read-only paths */
  readOnlyPaths?: string[];
  /** Writable paths */
  writablePaths?: string[];
  /** Hidden paths (not accessible) */
  hiddenPaths?: string[];
  /** Allow temporary file creation */
  allowTempFiles?: boolean;
  /** Maximum total file size */
  maxTotalSize?: number;
}

/**
 * Sandbox configuration for isolated execution
 */
export interface SandboxConfig {
  /** Resource limits */
  resources?: ResourceLimits;
  /** Network configuration */
  network?: NetworkConfig;
  /** File system restrictions */
  fileSystem?: FileSystemRestrictions;
  /** Environment variables to inject */
  environment?: Record<string, string>;
  /** Working directory inside sandbox */
  workingDirectory?: string;
  /** User to run as */
  user?: string;
  /** Group to run as */
  group?: string;
  /** Enable seccomp/AppArmor */
  enableSeccomp?: boolean;
  /** Read-only root filesystem */
  readOnlyRoot?: boolean;
}

/**
 * Terminal backend interface
 *
 * Abstract interface for different terminal backends (local, Docker, SSH, etc.)
 */
export interface ITerminalBackend {
  /** Backend identifier */
  readonly id: string;
  /** Backend type */
  readonly type: string;
  /** Backend display name */
  readonly name: string;

  /** Get backend capabilities */
  getCapabilities(): Promise<TerminalCapabilities>;

  /** Check if backend is available */
  isAvailable(): Promise<boolean>;

  /** Initialize the backend */
  initialize(): Promise<void>;

  /** Dispose of the backend */
  dispose(): Promise<void>;

  /** Execute a command */
  execute(command: string, options?: TerminalExecuteOptions): Promise<TerminalExecuteResult>;

  /** Execute a command in the background */
  executeBackground(command: string, options?: TerminalExecuteOptions): Promise<string>;

  /** Get background task status */
  getBackgroundTask(taskId: string): Promise<BackgroundTask | null>;

  /** Get background task output */
  getBackgroundTaskOutput(taskId: string, offset?: number): Promise<{ output: string; errorOutput: string; status: BackgroundTaskStatus; exitCode?: number } | null>;

  /** Cancel a background task */
  cancelBackgroundTask(taskId: string, signal?: "SIGTERM" | "SIGKILL"): Promise<boolean>;

  /** List all background tasks */
  listBackgroundTasks(): Promise<BackgroundTask[]>;

  /** Kill a process by PID */
  killProcess(pid: number, signal?: "SIGTERM" | "SIGKILL"): Promise<boolean>;

  /** Check if a path exists */
  pathExists(path: string): Promise<boolean>;

  /** Read a file */
  readFile(path: string, encoding?: BufferEncoding): Promise<string | Buffer>;

  /** Write a file */
  writeFile(path: string, content: string | Buffer, encoding?: BufferEncoding): Promise<void>;

  /** Delete a file */
  deleteFile(path: string): Promise<void>;

  /** Create a directory */
  createDirectory(path: string, recursive?: boolean): Promise<void>;

  /** Delete a directory */
  deleteDirectory(path: string, recursive?: boolean): Promise<void>;

  /** List directory contents */
  listDirectory(path: string): Promise<FileSystemEntry[]>;

  /** Get file/directory info */
  getFileInfo(path: string): Promise<FileSystemEntry | null>;

  /** Set environment variable */
  setEnvironmentVariable(key: string, value: string): Promise<void>;

  /** Get environment variable */
  getEnvironmentVariable(key: string): Promise<string | undefined>;

  /** Get all environment variables */
  getEnvironmentVariables(): Promise<Record<string, string>>;

  /** Resolve a path (handle ~, ., ..) */
  resolvePath(path: string): Promise<string>;

  /** Get current working directory */
  getCurrentDirectory(): Promise<string>;

  /** Change working directory */
  changeDirectory(path: string): Promise<void>;
}

/**
 * Terminal backend constructor options
 */
export interface TerminalBackendOptions {
  /** Backend-specific configuration */
  config?: Record<string, unknown>;
  /** Sandbox configuration */
  sandbox?: SandboxConfig;
  /** Default timeout */
  defaultTimeout?: number;
  /** Maximum output size */
  maxOutputSize?: number;
  /** Enable verbose logging */
  verbose?: boolean;
}

/**
 * Docker-specific configuration
 */
export interface DockerConfig {
  /** Docker host (e.g., "unix:///var/run/docker.sock") */
  host?: string;
  /** Docker image to use */
  image: string;
  /** Container name prefix */
  containerPrefix?: string;
  /** Auto-remove container after execution */
  autoRemove?: boolean;
  /** Keep container running for reuse */
  keepAlive?: boolean;
  /** Volume mounts */
  volumes?: Array<{ source: string; target: string; readOnly?: boolean }>;
  /** Port mappings */
  ports?: Array<{ host: number; container: number }>;
  /** Network mode */
  networkMode?: string;
  /** Extra hosts */
  extraHosts?: string[];
  /** DNS servers */
  dns?: string[];
  /** Entrypoint override */
  entrypoint?: string[];
  /** Command override */
  cmd?: string[];
}

/**
 * SSH-specific configuration
 */
export interface SSHConfig {
  /** SSH host */
  host: string;
  /** SSH port */
  port?: number;
  /** Username */
  username: string;
  /** Authentication method */
  auth: {
    type: "password" | "privateKey" | "agent";
    /** Password (for password auth) */
    password?: string;
    /** Private key path (for privateKey auth) */
    privateKeyPath?: string;
    /** Private key content (for privateKey auth) */
    privateKey?: string;
    /** Passphrase (for privateKey auth) */
    passphrase?: string;
  };
  /** Connection timeout */
  connectTimeout?: number;
  /** Keepalive interval */
  keepaliveInterval?: number;
  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
  /** Reconnect delay */
  reconnectDelay?: number;
  /** Enable compression */
  compress?: boolean;
  /** Known hosts file path */
  knownHostsPath?: string;
  /** Strict host key checking */
  strictHostKeyChecking?: boolean;
  /** Jump host (bastion) configuration */
  jumpHost?: Omit<SSHConfig, "jumpHost">;
}

/**
 * Daytona-specific configuration
 */
export interface DaytonaConfig {
  /** Daytona API URL */
  apiUrl: string;
  /** API key */
  apiKey: string;
  /** Workspace ID */
  workspaceId?: string;
  /** Workspace name */
  workspaceName?: string;
  /** Target (region) */
  target?: string;
  /** IDE configuration */
  ide?: "vscode" | "jetbrains" | "ssh";
  /** Auto-create workspace if not exists */
  autoCreate?: boolean;
  /** Auto-pause workspace after inactivity (minutes) */
  autoPauseMinutes?: number;
  /** Auto-stop workspace after inactivity (minutes) */
  autoStopMinutes?: number;
}
