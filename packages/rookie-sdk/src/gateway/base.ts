// Multi-platform Gateway: Base interfaces and types (P3-T2)

import { EventEmitter } from "node:events";
import { Message } from "../agent/types.js";

// ─── Types ───────────────────────────────────────────────────────

export interface GatewayConfig {
  /** Platform identifier */
  platform: string;
  /** Enable/disable this gateway */
  enabled: boolean;
  /** Webhook/connection credentials */
  credentials: Record<string, string>;
  /** Allowed channels/users (empty = all) */
  allowlist?: string[];
  /** Blocked channels/users */
  blocklist?: string[];
}

export interface GatewayMessage {
  /** Unique message ID */
  id: string;
  /** Platform identifier */
  platform: string;
  /** Channel/room ID */
  channelId: string;
  /** User ID */
  userId: string;
  /** User display name */
  userName: string;
  /** Message text content */
  text: string;
  /** Timestamp */
  timestamp: number;
  /** Reply to message ID */
  replyTo?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface GatewaySendOptions {
  /** Reply to specific message */
  replyTo?: string;
  /** Thread ID for threaded replies */
  threadId?: string;
  /** Markdown formatting */
  markdown?: boolean;
  /** Silent message (no notification) */
  silent?: boolean;
}

export interface GatewayStats {
  platform: string;
  connected: boolean;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  lastActivity: number;
}

// ─── Abstract Gateway ────────────────────────────────────────────

export abstract class Gateway extends EventEmitter {
  protected config: GatewayConfig;
  protected stats: GatewayStats;
  protected connected = false;

  constructor(config: GatewayConfig) {
    super();
    this.config = config;
    this.stats = {
      platform: config.platform,
      connected: false,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      lastActivity: Date.now(),
    };
  }

  /**
   * Connect to the platform.
   */
  abstract connect(): Promise<boolean>;

  /**
   * Disconnect from the platform.
   */
  abstract disconnect(): Promise<void>;

  /**
   * Send a message to a channel.
   */
  abstract sendMessage(
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void>;

  /**
   * Check if gateway is connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get gateway statistics.
   */
  getStats(): GatewayStats {
    return { ...this.stats };
  }

  /**
   * Check if a user/channel is allowed.
   */
  protected isAllowed(id: string): boolean {
    if (this.config.blocklist?.includes(id)) return false;
    if (this.config.allowlist && this.config.allowlist.length > 0) {
      return this.config.allowlist.includes(id);
    }
    return true;
  }

  /**
   * Handle incoming message (called by subclasses).
   */
  protected handleMessage(message: GatewayMessage): void {
    if (!this.isAllowed(message.userId) || !this.isAllowed(message.channelId)) {
      return;
    }

    this.stats.messagesReceived++;
    this.stats.lastActivity = Date.now();
    this.emit("message", message);
  }

  /**
   * Handle errors (called by subclasses).
   */
  protected handleError(error: Error): void {
    this.stats.errors++;
    this.emit("error", error);
  }
}

// ─── Gateway Registry ────────────────────────────────────────────

export class GatewayRegistry {
  private gateways = new Map<string, Gateway>();

  /**
   * Register a gateway.
   */
  register(gateway: Gateway): void {
    this.gateways.set(gateway["config"].platform, gateway);
  }

  /**
   * Get a gateway by platform.
   */
  get(platform: string): Gateway | undefined {
    return this.gateways.get(platform);
  }

  /**
   * Get all registered gateways.
   */
  getAll(): Gateway[] {
    return Array.from(this.gateways.values());
  }

  /**
   * Connect all enabled gateways.
   */
  async connectAll(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    for (const [platform, gateway] of this.gateways) {
      if (gateway["config"].enabled) {
        try {
          const connected = await gateway.connect();
          results.set(platform, connected);
        } catch (error) {
          results.set(platform, false);
        }
      } else {
        results.set(platform, false);
      }
    }

    return results;
  }

  /**
   * Disconnect all gateways.
   */
  async disconnectAll(): Promise<void> {
    for (const gateway of this.gateways.values()) {
      await gateway.disconnect();
    }
  }

  /**
   * Get stats for all gateways.
   */
  getAllStats(): GatewayStats[] {
    return this.getAll().map((g) => g.getStats());
  }
}

// ─── Message Router ──────────────────────────────────────────────

export interface RouterConfig {
  /** Default gateway for outgoing messages */
  defaultGateway?: string;
  /** Route by channel ID */
  channelRoutes?: Record<string, string>;
  /** Route by user ID */
  userRoutes?: Record<string, string>;
}

/**
 * Routes messages between gateways and the agent.
 */
export class MessageRouter extends EventEmitter {
  private registry: GatewayRegistry;
  private _config: RouterConfig;

  constructor(registry: GatewayRegistry, config: RouterConfig = {}) {
    super();
    this.registry = registry;
    this._config = config;
  }

  /**
   * Get router configuration.
   */
  getConfig(): RouterConfig {
    return { ...this._config };
  }

  /**
   * Route an incoming message to the agent.
   */
  routeIncoming(message: GatewayMessage): void {
    // Convert gateway message to agent message format
    const agentMessage: Message = {
      role: "user",
      content: message.text,
    };

    this.emit("agent:message", {
      message: agentMessage,
      platform: message.platform,
      channelId: message.channelId,
      userId: message.userId,
      reply: (text: string, options?: GatewaySendOptions) => {
        this.sendReply(message.platform, message.channelId, text, {
          ...options,
          replyTo: message.id,
        });
      },
    });
  }

  /**
   * Send a reply to a specific platform/channel.
   */
  async sendReply(
    platform: string,
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    const gateway = this.registry.get(platform);
    if (!gateway || !gateway.isConnected()) {
      throw new Error(`Gateway ${platform} not available`);
    }

    await gateway.sendMessage(channelId, text, options);
  }

  /**
   * Broadcast a message to all connected gateways.
   */
  async broadcast(text: string, _options?: GatewaySendOptions): Promise<void> {
    const gateways = this.registry.getAll().filter((g) => g.isConnected());

    await Promise.all(
      gateways.map(async (gateway) => {
        // This would need channel IDs - simplified version
        this.emit("broadcast", {
          platform: gateway["config"].platform,
          text,
        });
      })
    );
  }
}
