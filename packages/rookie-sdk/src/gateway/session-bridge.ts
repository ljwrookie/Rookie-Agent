/**
 * Session Bridge - Cross-platform session binding and synchronization
 *
 * Enables seamless conversation continuity across multiple platforms:
 * - Session migration between platforms
 * - Message synchronization
 * - Context preservation
 */

import type { GatewayMessage, GatewaySendOptions } from "./base.js";
import type { GatewayManager, GatewaySession } from "./manager.js";

export interface SessionBridgeConfig {
  /** Enable automatic session migration */
  autoMigrate?: boolean;
  /** Context preservation strategy */
  contextStrategy?: "full" | "summary" | "recent";
  /** Number of recent messages to preserve */
  recentMessageCount?: number;
  /** Session timeout in ms */
  sessionTimeout?: number;
}

export interface BridgedSession extends GatewaySession {
  /** Linked sessions on other platforms */
  linkedSessions: Array<{
    platform: string;
    channelId: string;
    userId: string;
    linkedAt: number;
  }>;
  /** Session context/messages */
  context: BridgedContext;
}

export interface BridgedContext {
  /** Session messages */
  messages: BridgedMessage[];
  /** Session summary (if using summary strategy) */
  summary?: string;
  /** Context metadata */
  metadata: Record<string, unknown>;
}

export interface BridgedMessage {
  id: string;
  platform: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface MigrationResult {
  success: boolean;
  fromSession: string;
  toSession?: string;
  error?: string;
  preservedMessages: number;
}

/**
 * Session Bridge - Cross-platform conversation continuity
 */
export class SessionBridge {
  private manager: GatewayManager;
  private config: Required<SessionBridgeConfig>;
  private bridgedSessions = new Map<string, BridgedSession>();
  private messageHistory = new Map<string, BridgedMessage[]>();

  constructor(manager: GatewayManager, config: SessionBridgeConfig = {}) {
    this.manager = manager;
    this.config = {
      autoMigrate: config.autoMigrate ?? true,
      contextStrategy: config.contextStrategy ?? "recent",
      recentMessageCount: config.recentMessageCount ?? 10,
      sessionTimeout: config.sessionTimeout ?? 30 * 60 * 1000, // 30 minutes
    };

    this.setupEventHandlers();
  }

  /**
   * Create a bridged session
   */
  createSession(
    sessionId: string,
    platform: string,
    channelId: string,
    userId: string,
    metadata?: Record<string, unknown>
  ): BridgedSession {
    const existing = this.getBridgedSession(sessionId);
    if (existing) {
      return existing;
    }

    // Bind with gateway manager
    const baseSession = this.manager.bindSession(
      sessionId,
      platform,
      channelId,
      userId,
      metadata
    );

    const bridged: BridgedSession = {
      ...baseSession,
      linkedSessions: [],
      context: {
        messages: [],
        metadata: {},
      },
    };

    this.bridgedSessions.set(sessionId, bridged);
    this.messageHistory.set(sessionId, []);

    return bridged;
  }

  /**
   * Get a bridged session by ID
   */
  getBridgedSession(sessionId: string): BridgedSession | undefined {
    return this.bridgedSessions.get(sessionId);
  }

  /**
   * Link two sessions together (cross-platform binding)
   */
  linkSessions(
    primarySessionId: string,
    secondaryPlatform: string,
    secondaryChannelId: string,
    secondaryUserId: string
  ): boolean {
    const primary = this.bridgedSessions.get(primarySessionId);
    if (!primary) {
      return false;
    }

    // Check if already linked
    const existingLink = primary.linkedSessions.find(
      (s) =>
        s.platform === secondaryPlatform &&
        s.channelId === secondaryChannelId &&
        s.userId === secondaryUserId
    );

    if (existingLink) {
      return true;
    }

    // Add link
    primary.linkedSessions.push({
      platform: secondaryPlatform,
      channelId: secondaryChannelId,
      userId: secondaryUserId,
      linkedAt: Date.now(),
    });

    // Bind with gateway manager
    this.manager.bindSession(
      primarySessionId,
      secondaryPlatform,
      secondaryChannelId,
      secondaryUserId
    );

    // Sync context to new session
    this.syncContext(primarySessionId, secondaryPlatform, secondaryChannelId);

    return true;
  }

  /**
   * Unlink a session
   */
  unlinkSession(
    sessionId: string,
    platform: string,
    channelId: string,
    userId: string
  ): boolean {
    const session = this.bridgedSessions.get(sessionId);
    if (!session) {
      return false;
    }

    const initialLength = session.linkedSessions.length;
    session.linkedSessions = session.linkedSessions.filter(
      (s) =>
        !(s.platform === platform && s.channelId === channelId && s.userId === userId)
    );

    if (session.linkedSessions.length < initialLength) {
      this.manager.unbindSession(platform, channelId, userId);
      return true;
    }

    return false;
  }

  /**
   * Migrate session from one platform to another
   */
  async migrateSession(
    sessionId: string,
    toPlatform: string,
    toChannelId: string,
    toUserId: string
  ): Promise<MigrationResult> {
    const session = this.bridgedSessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        fromSession: sessionId,
        error: "Session not found",
        preservedMessages: 0,
      };
    }

    const messages = this.messageHistory.get(sessionId) ?? [];
    const preservedMessages = this.getPreservedMessages(messages);

    try {
      // Create new session binding
      this.manager.bindSession(sessionId, toPlatform, toChannelId, toUserId);

      // Link the new location
      this.linkSessions(sessionId, toPlatform, toChannelId, toUserId);

      // Send context summary to new platform
      await this.sendContextSummary(sessionId, toPlatform, toChannelId);

      return {
        success: true,
        fromSession: sessionId,
        toSession: sessionId, // Same session, new location
        preservedMessages: preservedMessages.length,
      };
    } catch (error) {
      return {
        success: false,
        fromSession: sessionId,
        error: error instanceof Error ? error.message : String(error),
        preservedMessages: 0,
      };
    }
  }

  /**
   * Add message to session
   */
  addMessage(
    sessionId: string,
    message: Omit<BridgedMessage, "id" | "timestamp">
  ): BridgedMessage {
    const fullMessage: BridgedMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: Date.now(),
    };

    const history = this.messageHistory.get(sessionId);
    if (history) {
      history.push(fullMessage);

      // Trim if needed
      if (history.length > this.config.recentMessageCount * 2) {
        history.splice(0, history.length - this.config.recentMessageCount);
      }
    }

    // Update session context
    const session = this.bridgedSessions.get(sessionId);
    if (session) {
      session.context.messages = this.getPreservedMessages(history ?? []);
    }

    // Broadcast to linked sessions
    this.broadcastToLinkedSessions(sessionId, fullMessage);

    return fullMessage;
  }

  /**
   * Get session messages
   */
  getMessages(sessionId: string): BridgedMessage[] {
    return this.messageHistory.get(sessionId) ?? [];
  }

  /**
   * Get recent messages for context
   */
  getContextMessages(sessionId: string): BridgedMessage[] {
    const messages = this.messageHistory.get(sessionId) ?? [];
    return this.getPreservedMessages(messages);
  }

  /**
   * Send message to all linked sessions
   */
  async broadcast(
    sessionId: string,
    content: string,
    options?: GatewaySendOptions,
    excludePlatform?: string
  ): Promise<Map<string, boolean>> {
    const session = this.bridgedSessions.get(sessionId);
    if (!session) {
      return new Map();
    }

    const results = new Map<string, boolean>();

    // Send to primary session
    if (excludePlatform !== session.platform) {
      try {
        await this.manager.sendMessage(
          session.platform,
          session.channelId,
          content,
          options
        );
        results.set(session.platform, true);
      } catch {
        results.set(session.platform, false);
      }
    }

    // Send to linked sessions
    for (const link of session.linkedSessions) {
      if (excludePlatform === link.platform) {
        continue;
      }

      try {
        await this.manager.sendMessage(
          link.platform,
          link.channelId,
          content,
          options
        );
        results.set(link.platform, true);
      } catch {
        results.set(link.platform, false);
      }
    }

    return results;
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions(): string[] {
    const now = Date.now();
    const expired: string[] = [];

    for (const [sessionId, session] of this.bridgedSessions) {
      if (now - session.lastActivity > this.config.sessionTimeout) {
        expired.push(sessionId);
      }
    }

    for (const sessionId of expired) {
      this.destroySession(sessionId);
    }

    return expired;
  }

  /**
   * Destroy a session and clean up resources
   */
  destroySession(sessionId: string): boolean {
    const session = this.bridgedSessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Unbind from gateway manager
    this.manager.unbindSession(session.platform, session.channelId, session.userId);

    for (const link of session.linkedSessions) {
      this.manager.unbindSession(link.platform, link.channelId, link.userId);
    }

    // Clean up
    this.bridgedSessions.delete(sessionId);
    this.messageHistory.delete(sessionId);

    return true;
  }

  /**
   * Get bridge statistics
   */
  getStats(): {
    sessions: number;
    linkedSessions: number;
    totalMessages: number;
    strategy: string;
  } {
    let linkedSessions = 0;
    let totalMessages = 0;

    for (const session of this.bridgedSessions.values()) {
      linkedSessions += session.linkedSessions.length;
    }

    for (const messages of this.messageHistory.values()) {
      totalMessages += messages.length;
    }

    return {
      sessions: this.bridgedSessions.size,
      linkedSessions,
      totalMessages,
      strategy: this.config.contextStrategy,
    };
  }

  // ─── Private Methods ────────────────────────────────────────────

  private setupEventHandlers(): void {
    this.manager.on("message", (message: GatewayMessage) => {
      this.handleIncomingMessage(message);
    });

    this.manager.on("session:message", ({ session, message }) => {
      this.handleSessionMessage(session, message);
    });
  }

  private handleIncomingMessage(message: GatewayMessage): void {
    // Find associated session
    const session = this.manager.getSession(
      message.platform,
      message.channelId,
      message.userId
    );

    if (session) {
      this.addMessage(session.id, {
        platform: message.platform,
        role: "user",
        content: message.text,
        metadata: message.metadata,
      });
    }
  }

  private handleSessionMessage(
    session: GatewaySession,
    message: GatewayMessage
  ): void {
    // Already handled in handleIncomingMessage
  }

  private getPreservedMessages(messages: BridgedMessage[]): BridgedMessage[] {
    switch (this.config.contextStrategy) {
      case "full":
        return messages;
      case "summary":
        // Return recent messages for now, summary would be generated
        return messages.slice(-this.config.recentMessageCount);
      case "recent":
      default:
        return messages.slice(-this.config.recentMessageCount);
    }
  }

  private async syncContext(
    sessionId: string,
    toPlatform: string,
    toChannelId: string
  ): Promise<void> {
    const session = this.bridgedSessions.get(sessionId);
    if (!session) {
      return;
    }

    const contextMessages = this.getContextMessages(sessionId);

    if (contextMessages.length > 0) {
      const summary = this.generateContextSummary(contextMessages);

      try {
        await this.manager.sendMessage(
          toPlatform,
          toChannelId,
          `📋 *Context synchronized from other platforms*\n\n${summary}`,
          { markdown: true }
        );
      } catch {
        // Ignore sync errors
      }
    }
  }

  private async sendContextSummary(
    sessionId: string,
    toPlatform: string,
    toChannelId: string
  ): Promise<void> {
    const messages = this.getContextMessages(sessionId);

    if (messages.length === 0) {
      return;
    }

    const summary = this.generateContextSummary(messages);

    try {
      await this.manager.sendMessage(
        toPlatform,
        toChannelId,
        `📋 *Session Migrated*\n\n${summary}`,
        { markdown: true }
      );
    } catch {
      // Ignore send errors
    }
  }

  private generateContextSummary(messages: BridgedMessage[]): string {
    const recentMessages = messages.slice(-5);
    const summary = recentMessages
      .map((m) => `${m.role === "user" ? "👤" : "🤖"} ${m.content.substring(0, 100)}${m.content.length > 100 ? "..." : ""}`)
      .join("\n");

    return summary;
  }

  private broadcastToLinkedSessions(
    sessionId: string,
    message: BridgedMessage
  ): void {
    // This could sync messages across platforms
    // For now, we just store them locally
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
