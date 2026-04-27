/**
 * Pipe IPC / LAN Group Control (D4)
 *
 * Provides inter-instance communication via Unix sockets (local) and mDNS (LAN).
 * Each Rookie instance registers a Unix socket in ~/.rookie/pipes/ for discovery.
 */

import { createServer, Server, Socket } from "net";
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

// Pipes directory
const PIPES_DIR = join(homedir(), ".rookie", "pipes");

// Message types
export interface PipeMessage {
  from: string;      // Instance ID
  to?: string;       // Target instance (optional - broadcast if not set)
  type: "ping" | "pong" | "message" | "broadcast" | "status";
  payload: unknown;
  timestamp: number;
}

export interface PipeInstance {
  id: string;
  socketPath: string;
  pid: number;
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

export interface PipeManagerOptions {
  instanceId?: string;
  metadata?: Record<string, unknown>;
  enableLan?: boolean;  // Enable mDNS discovery (FEATURE_LAN=1)
}

/**
 * PipeManager: Manages Unix socket IPC between Rookie instances.
 * D4: Pipe IPC / LAN Group Control
 */
export class PipeManager extends EventEmitter {
  private instanceId: string;
  private socketPath: string;
  private server: Server | null = null;
  private connections = new Map<string, Socket>();  // instanceId -> socket
  private instances = new Map<string, PipeInstance>(); // Known instances
  private metadata: Record<string, unknown>;
  private enableLan: boolean;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(options: PipeManagerOptions = {}) {
    super();
    this.instanceId = options.instanceId || `rookie-${Date.now()}-${process.pid}`;
    this.socketPath = join(PIPES_DIR, `${this.instanceId}.sock`);
    this.metadata = options.metadata || {};
    this.enableLan = options.enableLan || process.env.FEATURE_LAN === "1";
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Start the pipe server and register this instance.
   */
  async start(): Promise<void> {
    // Ensure pipes directory exists
    await fs.mkdir(PIPES_DIR, { recursive: true });

    // Clean up any stale socket
    try {
      await fs.unlink(this.socketPath);
    } catch {
      // Ignore if doesn't exist
    }

    // Create server
    this.server = createServer((socket) => {
      this.handleConnection(socket);
    });

    // Start listening
    await new Promise<void>((resolve, reject) => {
      this.server!.on("error", reject);
      this.server!.listen(this.socketPath, () => {
        this.server!.off("error", reject);
        resolve();
      });
    });

    // Make socket accessible to other users (if needed)
    try {
      await fs.chmod(this.socketPath, 0o666);
    } catch {
      // Ignore permission errors
    }

    // Start heartbeat
    this.startHeartbeat();

    // Discover other instances
    await this.discoverInstances();

    // Start LAN discovery if enabled
    if (this.enableLan) {
      await this.startLanDiscovery();
    }

    this.emit("started", { instanceId: this.instanceId, socketPath: this.socketPath });
  }

  /**
   * Stop the pipe server and cleanup.
   */
  async stop(): Promise<void> {
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Close all connections
    for (const [id, socket] of this.connections) {
      socket.end();
      this.connections.delete(id);
    }

    // Stop server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    // Remove socket file
    try {
      await fs.unlink(this.socketPath);
    } catch {
      // Ignore
    }

    this.emit("stopped", { instanceId: this.instanceId });
  }

  /**
   * List all active instances.
   */
  async listInstances(): Promise<PipeInstance[]> {
    await this.discoverInstances();
    return Array.from(this.instances.values());
  }

  /**
   * Send a message to a specific instance.
   */
  async sendTo(instanceId: string, payload: unknown): Promise<boolean> {
    // Check if already connected
    let socket = this.connections.get(instanceId);

    if (!socket) {
      // Try to connect
      const instance = this.instances.get(instanceId);
      if (!instance) {
        // Try to discover first
        await this.discoverInstances();
        const discovered = this.instances.get(instanceId);
        if (!discovered) {
          return false;
        }
        const newSocket = await this.connectTo(discovered.socketPath);
        if (!newSocket) return false;
        socket = newSocket;
        this.connections.set(instanceId, socket);
      } else {
        const newSocket = await this.connectTo(instance.socketPath);
        if (!newSocket) return false;
        socket = newSocket;
        this.connections.set(instanceId, socket);
      }
    }

    const message: PipeMessage = {
      from: this.instanceId,
      to: instanceId,
      type: "message",
      payload,
      timestamp: Date.now(),
    };

    return this.sendMessage(socket, message);
  }

  /**
   * Broadcast a message to all instances.
   */
  async broadcast(payload: unknown): Promise<number> {
    const instances = await this.listInstances();
    let sent = 0;

    for (const instance of instances) {
      if (instance.id === this.instanceId) continue;

      const success = await this.sendTo(instance.id, payload);
      if (success) sent++;
    }

    return sent;
  }

  /**
   * Ping all instances to check connectivity.
   */
  async pingAll(): Promise<Map<string, boolean>> {
    const instances = await this.listInstances();
    const results = new Map<string, boolean>();

    for (const instance of instances) {
      if (instance.id === this.instanceId) {
        results.set(instance.id, true);
        continue;
      }

      const success = await this.ping(instance.id);
      results.set(instance.id, success);
    }

    return results;
  }

  /**
   * Ping a specific instance.
   */
  async ping(instanceId: string): Promise<boolean> {
    const message: PipeMessage = {
      from: this.instanceId,
      to: instanceId,
      type: "ping",
      payload: { timestamp: Date.now() },
      timestamp: Date.now(),
    };

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);

      // Send ping and wait for pong
      const handler = (response: PipeMessage) => {
        if (response.from === instanceId && response.type === "pong") {
          clearTimeout(timeout);
          this.off("message", handler);
          resolve(true);
        }
      };

      this.on("message", handler);
      this.sendTo(instanceId, message).then((sent) => {
        if (!sent) {
          clearTimeout(timeout);
          this.off("message", handler);
          resolve(false);
        }
      });
    });
  }

  // ─── Internal ──────────────────────────────────────────

  private handleConnection(socket: Socket): void {
    let buffer = "";

    socket.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const message = JSON.parse(trimmed) as PipeMessage;
          this.handleMessage(message, socket);
        } catch {
          // Malformed JSON - ignore
        }
      }
    });

    socket.on("close", () => {
      // Remove from connections
      for (const [id, conn] of this.connections) {
        if (conn === socket) {
          this.connections.delete(id);
          break;
        }
      }
    });

    socket.on("error", (err) => {
      this.emit("error", err);
    });
  }

  private handleMessage(message: PipeMessage, socket: Socket): void {
    // Update instance info
    this.instances.set(message.from, {
      id: message.from,
      socketPath: this.socketPath, // Will be updated on actual connection
      pid: process.pid,
      lastSeen: Date.now(),
    });

    switch (message.type) {
      case "ping":
        // Respond with pong
        this.sendMessage(socket, {
          from: this.instanceId,
          to: message.from,
          type: "pong",
          payload: { timestamp: Date.now() },
          timestamp: Date.now(),
        });
        break;

      case "pong":
        // Ping response - handled by ping()
        this.emit("message", message);
        break;

      case "message":
      case "broadcast":
        // Emit to listeners
        this.emit("message", message);
        break;

      case "status":
        // Status update
        this.emit("status", message);
        break;
    }
  }

  private async discoverInstances(): Promise<void> {
    try {
      const files = await fs.readdir(PIPES_DIR);
      const sockets = files.filter((f) => f.endsWith(".sock"));

      for (const sock of sockets) {
        const instanceId = basename(sock, ".sock");
        const socketPath = join(PIPES_DIR, sock);

        if (instanceId === this.instanceId) continue;

        // Check if socket is still valid
        try {
          const stats = await fs.stat(socketPath);
          if (!stats.isSocket()) continue;
        } catch {
          // Stale socket file - remove it
          try {
            await fs.unlink(socketPath);
          } catch {
            // Ignore
          }
          continue;
        }

        this.instances.set(instanceId, {
          id: instanceId,
          socketPath,
          pid: 0, // Unknown until we connect
          lastSeen: Date.now(),
        });
      }
    } catch {
      // Directory might not exist yet
    }
  }

  private async connectTo(socketPath: string): Promise<Socket | null> {
    return new Promise((resolve) => {
      const socket = new Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, 5000);

      socket.connect(socketPath, () => {
        clearTimeout(timeout);
        resolve(socket);
      });

      socket.on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  private sendMessage(socket: Socket, message: PipeMessage): boolean {
    try {
      socket.write(JSON.stringify(message) + "\n");
      return true;
    } catch {
      return false;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      // Clean up stale instances
      const now = Date.now();
      for (const [id, instance] of this.instances) {
        if (now - instance.lastSeen > 60000) {
          // 1 minute timeout
          this.instances.delete(id);
          this.connections.delete(id);
        }
      }

      // Broadcast status
      this.broadcast({
        type: "heartbeat",
        instanceId: this.instanceId,
        pid: process.pid,
        timestamp: Date.now(),
      }).catch(() => {
        // Ignore broadcast errors
      });
    }, 30000); // Every 30 seconds
  }

  private async startLanDiscovery(): Promise<void> {
    // D4: mDNS discovery (requires bonjour-service package)
    // @ts-expect-error - bonjour-service is an optional dependency
    const bonjourService = await import("bonjour-service").catch(() => null);
    if (!bonjourService) {
      this.emit("error", new Error("bonjour-service not installed, LAN discovery disabled"));
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Bonjour = (bonjourService as any).Bonjour;
    if (!Bonjour) {
      this.emit("error", new Error("bonjour-service not installed, LAN discovery disabled"));
      return;
    }
    const bonjour = new Bonjour();

    // Advertise this instance
    bonjour.publish({
      name: this.instanceId,
      type: "rookie",
      port: 0, // No TCP port, just discovery
      txt: {
        socketPath: this.socketPath,
        pid: String(process.pid),
        ...this.metadata,
      },
    });

    // Discover other instances
    const browser = bonjour.find({ type: "rookie" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    browser.on("up", (service: any) => {
      if (service.name === this.instanceId) return;

      const txt = service.txt as Record<string, string> | undefined;
      if (txt?.socketPath) {
        this.instances.set(service.name, {
          id: service.name,
          socketPath: txt.socketPath,
          pid: parseInt(txt.pid || "0", 10),
          lastSeen: Date.now(),
          metadata: txt,
        });
      }
    });

    this.emit("lan-started", { instanceId: this.instanceId });
  }
}

// Global pipe manager instance
let globalPipeManager: PipeManager | null = null;

export function getGlobalPipeManager(): PipeManager | null {
  return globalPipeManager;
}

export function setGlobalPipeManager(manager: PipeManager | null): void {
  globalPipeManager = manager;
}

export async function initPipeManager(options?: PipeManagerOptions): Promise<PipeManager> {
  if (globalPipeManager) {
    return globalPipeManager;
  }

  const manager = new PipeManager(options);
  await manager.start();
  globalPipeManager = manager;
  return manager;
}
