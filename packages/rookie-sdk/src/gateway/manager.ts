/**
 * Gateway Manager - Unified gateway management
 *
 * Provides centralized management for all platform gateways with:
 * - Cross-platform session binding
 * - Health monitoring
 * - Message routing
 * - Statistics aggregation
 */

import { EventEmitter } from "node:events";
import type { Gateway, GatewayConfig, GatewayMessage, GatewaySendOptions, GatewayStats } from "./base.js";
import { MessageRouter } from "./base.js";

export interface GatewayManagerConfig {
  /** Health check interval in ms */
  healthCheckInterval?: number;
  /** Auto-reconnect enabled */
  autoReconnect?: boolean;
  /** Reconnect delay in ms */
  reconnectDelay?: number;
  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
}

export interface GatewaySession {
  /** Session ID */
  id: string;
  /** Platform name */
  platform: string;
  /** Channel/room ID */
  channelId: string;
  /** User ID */
  userId: string;
  /** Session start time */
  startedAt: number;
  /** Last activity time */
  lastActivity: number;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

export interface GatewayHealth {
  platform: string;
  status: "healthy" | "degraded" | "unhealthy" | "disconnected";
  latency: number;
  lastPing: number;
  errors: number;
}

/**
 * Gateway Manager - Centralized gateway orchestration
 */
export class GatewayManager extends EventEmitter {
  private gateways = new Map<string, Gateway>();
  private sessions = new Map<string, GatewaySession>();
  private healthStatus = new Map<string, GatewayHealth>();
  private messageRouter: MessageRouter;
  private config: Required<GatewayManagerConfig>;
  private healthCheckTimer?: NodeJS.Timeout;
  private reconnectAttempts = new Map<string, number>();

  constructor(config: GatewayManagerConfig = {}) {
    super();
    this.config = {
      healthCheckInterval: config.healthCheckInterval ?? 30000,
      autoReconnect: config.autoReconnect ?? true,
      reconnectDelay: config.reconnectDelay ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
    };
    this.messageRouter = new MessageRouter({ get: () => undefined } as any, {});
  }

  /**
   * Register a gateway
   */
  register(gateway: Gateway): void {
    const platform = gateway["config"].platform;
    this.gateways.set(platform, gateway);

    // Set up event forwarding
    gateway.on("message", (message: GatewayMessage) => {
      this.handleIncomingMessage(message);
    });

    gateway.on("error", (error: Error) => {
      this.handleGatewayError(platform, error);
    });

    gateway.on("connected", () => {
      this.emit("gateway:connected", { platform });
      this.reconnectAttempts.set(platform, 0);
      this.updateHealthStatus(platform, "healthy");
    });

    gateway.on("disconnected", () => {
      this.emit("gateway:disconnected", { platform });
      this.updateHealthStatus(platform, "disconnected");

      if (this.config.autoReconnect) {
        this.scheduleReconnect(platform);
      }
    });

    this.emit("gateway:registered", { platform });
  }

  /**
   * Unregister a gateway
   */
  unregister(platform: string): void {
    const gateway = this.gateways.get(platform);
    if (gateway) {
      gateway.disconnect();
      this.gateways.delete(platform);
      this.healthStatus.delete(platform);
      this.emit("gateway:unregistered", { platform });
    }
  }

  /**
   * Get a gateway by platform
   */
  get(platform: string): Gateway | undefined {
    return this.gateways.get(platform);
  }

  /**
   * Get all registered gateways
   */
  getAll(): Gateway[] {
    return Array.from(this.gateways.values());
  }

  /**
   * Connect all enabled gateways
   */
  async connectAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [platform, gateway] of this.gateways) {
      if (gateway["config"].enabled) {
        try {
          const start = Date.now();
          const connected = await gateway.connect();
          const latency = Date.now() - start;

          results.set(platform, connected);

          if (connected) {
            this.updateHealthStatus(platform, "healthy", latency);
          } else {
            this.updateHealthStatus(platform, "unhealthy");
          }
        } catch (error) {
          results.set(platform, false);
          this.updateHealthStatus(platform, "unhealthy");
          this.handleGatewayError(platform, error as Error);
        }
      } else {
        results.set(platform, false);
      }
    }

    // Start health checks
    this.startHealthChecks();

    return results;
  }

  /**
   * Disconnect all gateways
   */
  async disconnectAll(): Promise<void> {
    this.stopHealthChecks();

    await Promise.all(
      Array.from(this.gateways.values()).map((gateway) => gateway.disconnect())
    );
  }

  /**
   * Send a message through a specific gateway
   */
  async sendMessage(
    platform: string,
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    const gateway = this.gateways.get(platform);
    if (!gateway) {
      throw new Error(`Gateway ${platform} not found`);
    }

    if (!gateway.isConnected()) {
      throw new Error(`Gateway ${platform} is not connected`);
    }

    await gateway.sendMessage(channelId, text, options);
  }

  /**
   * Broadcast a message to all connected gateways
   */
  async broadcast(
    text: string,
    options?: GatewaySendOptions,
    filter?: (platform: string) => boolean
  ): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    await Promise.all(
      Array.from(this.gateways.entries()).map(async ([platform, gateway]) => {
        if (filter && !filter(platform)) {
          results.set(platform, false);
          return;
        }

        if (!gateway.isConnected()) {
          results.set(platform, false);
          return;
        }

        try {
          // Get active channels for this gateway
          const channels = this.getActiveChannels(platform);

          await Promise.all(
            channels.map((channelId) =>
              gateway.sendMessage(channelId, text, options).catch(() => {})
            )
          );

          results.set(platform, true);
        } catch {
          results.set(platform, false);
        }
      })
    );

    return results;
  }

  /**
   * Bind a session to a gateway conversation
   */
  bindSession(
    sessionId: string,
    platform: string,
    channelId: string,
    userId: string,
    metadata?: Record<string, unknown>
  ): GatewaySession {
    const session: GatewaySession = {
      id: sessionId,
      platform,
      channelId,
      userId,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      metadata,
    };

    const key = this.sessionKey(platform, channelId, userId);
    this.sessions.set(key, session);

    this.emit("session:bound", session);
    return session;
  }

  /**
   * Unbind a session
   */
  unbindSession(platform: string, channelId: string, userId: string): boolean {
    const key = this.sessionKey(platform, channelId, userId);
    const session = this.sessions.get(key);

    if (session) {
      this.sessions.delete(key);
      this.emit("session:unbound", session);
      return true;
    }

    return false;
  }

  /**
   * Get session by platform/channel/user
   */
  getSession(
    platform: string,
    channelId: string,
    userId: string
  ): GatewaySession | undefined {
    const key = this.sessionKey(platform, channelId, userId);
    return this.sessions.get(key);
  }

  /**
   * Get session by ID
   */
  getSessionById(sessionId: string): GatewaySession | undefined {
    for (const session of this.sessions.values()) {
      if (session.id === sessionId) {
        return session;
      }
    }
    return undefined;
  }

  /**
   * Update session activity
   */
  touchSession(platform: string, channelId: string, userId: string): void {
    const key = this.sessionKey(platform, channelId, userId);
    const session = this.sessions.get(key);

    if (session) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): GatewaySession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions for a platform
   */
  getSessionsByPlatform(platform: string): GatewaySession[] {
    return Array.from(this.sessions.values()).filter(
      (s) => s.platform === platform
    );
  }

  /**
   * Get health status for all gateways
   */
  getHealthStatus(): GatewayHealth[] {
    return Array.from(this.healthStatus.values());
  }

  /**
   * Get health status for a specific gateway
   */
  getGatewayHealth(platform: string): GatewayHealth | undefined {
    return this.healthStatus.get(platform);
  }

  /**
   * Get aggregated statistics
   */
  getStats(): GatewayStats[] {
    return Array.from(this.gateways.values()).map((g) => g.getStats());
  }

  /**
   * Get detailed manager statistics
   */
  getManagerStats(): {
    gateways: number;
    connected: number;
    sessions: number;
    healthChecks: number;
  } {
    const connected = Array.from(this.gateways.values()).filter((g) =>
      g.isConnected()
    ).length;

    return {
      gateways: this.gateways.size,
      connected,
      sessions: this.sessions.size,
      healthChecks: this.config.healthCheckInterval,
    };
  }

  /**
   * Start health check monitoring
   */
  startHealthChecks(): void {
    if (this.healthCheckTimer) {
      return;
    }

    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop health check monitoring
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  // ─── Private Methods ────────────────────────────────────────────

  private handleIncomingMessage(message: GatewayMessage): void {
    // Update session activity if exists
    this.touchSession(message.platform, message.channelId, message.userId);

    // Emit for external handling
    this.emit("message", message);

    // Route to bound session if any
    const session = this.getSession(
      message.platform,
      message.channelId,
      message.userId
    );

    if (session) {
      this.emit("session:message", { session, message });
    }
  }

  private handleGatewayError(platform: string, error: Error): void {
    this.emit("gateway:error", { platform, error });

    const health = this.healthStatus.get(platform);
    if (health) {
      health.errors++;
    }
  }

  private updateHealthStatus(
    platform: string,
    status: GatewayHealth["status"],
    latency?: number
  ): void {
    const existing = this.healthStatus.get(platform);

    this.healthStatus.set(platform, {
      platform,
      status,
      latency: latency ?? existing?.latency ?? 0,
      lastPing: Date.now(),
      errors: existing?.errors ?? 0,
    });
  }

  private async performHealthChecks(): Promise<void> {
    for (const [platform, gateway] of this.gateways) {
      if (!gateway["config"].enabled) {
        continue;
      }

      const start = Date.now();
      const isConnected = gateway.isConnected();
      const latency = Date.now() - start;

      if (isConnected) {
        this.updateHealthStatus(platform, "healthy", latency);
      } else {
        const currentStatus = this.healthStatus.get(platform)?.status;
        if (currentStatus !== "disconnected") {
          this.updateHealthStatus(platform, "disconnected");

          if (this.config.autoReconnect) {
            this.scheduleReconnect(platform);
          }
        }
      }
    }

    this.emit("health:check", this.getHealthStatus());
  }

  private scheduleReconnect(platform: string): void {
    const attempts = this.reconnectAttempts.get(platform) ?? 0;

    if (attempts >= this.config.maxReconnectAttempts) {
      this.emit("gateway:reconnect:failed", { platform, attempts });
      return;
    }

    this.reconnectAttempts.set(platform, attempts + 1);

    setTimeout(() => {
      const gateway = this.gateways.get(platform);
      if (gateway && !gateway.isConnected()) {
        this.emit("gateway:reconnect:attempt", { platform, attempt: attempts + 1 });
        gateway.connect().catch(() => {});
      }
    }, this.config.reconnectDelay * (attempts + 1));
  }

  private sessionKey(platform: string, channelId: string, userId: string): string {
    return `${platform}:${channelId}:${userId}`;
  }

  private getActiveChannels(platform: string): string[] {
    const channels = new Set<string>();

    for (const session of this.sessions.values()) {
      if (session.platform === platform) {
        channels.add(session.channelId);
      }
    }

    return Array.from(channels);
  }
}

// Singleton instance for global access
let globalGatewayManager: GatewayManager | undefined;

export function getGlobalGatewayManager(): GatewayManager {
  if (!globalGatewayManager) {
    globalGatewayManager = new GatewayManager();
  }
  return globalGatewayManager;
}

export function setGlobalGatewayManager(manager: GatewayManager): void {
  globalGatewayManager = manager;
}
