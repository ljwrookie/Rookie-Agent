/**
 * DingTalk Gateway - 钉钉平台接入
 *
 * Features:
 * - Stream SDK 长连接
 * - AI Card 流式卡片
 * - 单聊/群聊支持
 * - 消息回调处理
 */

import { Gateway, GatewayConfig, GatewayMessage, GatewaySendOptions, GatewayStats } from "./base.js";
import { EventEmitter } from "node:events";

// DingTalk API types
export interface DingTalkConfig extends GatewayConfig {
  credentials: {
    appKey: string;
    appSecret: string;
    robotCode?: string;
  };
}

export interface DingTalkMessage {
  msgtype: string;
  content?: {
    text?: string;
  };
  markdown?: {
    title: string;
    text: string;
  };
  action_card?: {
    title: string;
    markdown: string;
    single_title?: string;
    single_url?: string;
  };
}

interface DingTalkStreamMessage {
  messageId: string;
  conversationType: "1" | "2"; // 1=单聊, 2=群聊
  chatbotCorpId?: string;
  chatbotUserId: string;
  msgtype: string;
  text?: { content: string };
  markdown?: { title: string; text: string };
  senderStaffId: string;
  senderNick: string;
  senderCorpId?: string;
  sessionWebhook: string;
  createAt: number;
  senderUserId: string;
  conversationTitle?: string;
  conversationId: string;
  robotCode: string;
}

export interface DingTalkAIStreamCard {
  cardTemplateId: string;
  cardData: {
    title?: string;
    content?: string;
    status?: "streaming" | "completed" | "error";
    markdown?: boolean;
  };
}

/**
 * DingTalk Gateway implementation
 */
export class DingTalkGateway extends Gateway {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private streamConnection: any = null;
  private messageHandlers = new Map<string, (message: DingTalkStreamMessage) => void>();
  private cardCallbacks = new Map<string, (data: any) => void>();

  constructor(config: DingTalkConfig) {
    super(config);
  }

  /**
   * Connect to DingTalk Stream API
   */
  async connect(): Promise<boolean> {
    try {
      // Get access token
      await this.refreshAccessToken();

      // Initialize Stream connection
      await this.initializeStream();

      this.connected = true;
      this.stats.connected = true;
      this.emit("connected");

      return true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }

  /**
   * Disconnect from DingTalk
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.stats.connected = false;

    if (this.streamConnection) {
      try {
        await this.streamConnection.close();
      } catch {
        // Ignore close errors
      }
      this.streamConnection = null;
    }

    this.accessToken = null;
    this.emit("disconnected");
  }

  /**
   * Send message to DingTalk
   */
  async sendMessage(
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    if (!this.connected || !this.accessToken) {
      throw new Error("DingTalk gateway not connected");
    }

    // Ensure token is valid
    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    const message: DingTalkMessage = options?.markdown
      ? {
          msgtype: "markdown",
          markdown: {
            title: "Rookie Agent",
            text: this.escapeMarkdown(text),
          },
        }
      : {
          msgtype: "text",
          content: { text },
        };

    // Send via webhook or API
    await this.sendToConversation(channelId, message);

    this.stats.messagesSent++;
    this.stats.lastActivity = Date.now();
  }

  /**
   * Send AI Card with streaming support
   */
  async sendAICard(
    channelId: string,
    cardData: {
      title: string;
      content: string;
      streaming?: boolean;
      markdown?: boolean;
    },
    options?: GatewaySendOptions
  ): Promise<{ cardInstanceId: string; update: (content: string) => Promise<void> }> {
    if (!this.connected) {
      throw new Error("DingTalk gateway not connected");
    }

    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const card: DingTalkAIStreamCard = {
      cardTemplateId: "rookie_ai_card",
      cardData: {
        title: cardData.title,
        content: cardData.content,
        status: cardData.streaming ? "streaming" : "completed",
        markdown: cardData.markdown ?? true,
      },
    };

    // Send initial card
    await this.sendCardToConversation(channelId, cardInstanceId, card);

    // Return update function for streaming
    const update = async (content: string) => {
      card.cardData.content = content;
      await this.updateCard(cardInstanceId, card);
    };

    return { cardInstanceId, update };

  }

  /**
   * Reply to a specific message
   */
  async replyToMessage(
    messageId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    // DingTalk doesn't have direct reply feature, but we can mention context
    const replyText = options?.markdown
      ? `> 回复消息\n\n${text}`
      : `回复: ${text}`;

    // Need to find the conversation ID from the original message
    const conversationId = this.findConversationByMessage(messageId);
    if (conversationId) {
      await this.sendMessage(conversationId, replyText, options);
    }
  }

  /**
   * Send message to specific user (单聊)
   */
  async sendPrivateMessage(
    userId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    await this.sendMessage(userId, text, options);
  }

  /**
   * Send message to group (群聊)
   */
  async sendGroupMessage(
    groupId: string,
    text: string,
    options?: GatewaySendOptions & { atUsers?: string[]; atAll?: boolean }
  ): Promise<void> {
    let finalText = text;

    // Handle @ mentions
    if (options?.atAll) {
      finalText = `@所有人 ${text}`;
    } else if (options?.atUsers && options.atUsers.length > 0) {
      const atMentions = options.atUsers.map((uid) => `@${uid}`).join(" ");
      finalText = `${atMentions} ${text}`;
    }

    await this.sendMessage(groupId, finalText, options);
  }

  // ─── Private Methods ────────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    const { appKey, appSecret } = this.config.credentials as { appKey: string; appSecret: string };

    try {
      const response = await fetch(
        `https://oapi.dingtalk.com/gettoken?appkey=${appKey}&appsecret=${appSecret}`
      );

      if (!response.ok) {
        throw new Error(`Failed to get access token: ${response.status}`);
      }

      const data = (await response.json()) as any;

      if (data.errcode !== 0) {
        throw new Error(`DingTalk API error: ${data.errmsg}`);
      }

      this.accessToken = data.access_token;
      // Token expires in 7200 seconds, refresh after 7000
      this.tokenExpiresAt = Date.now() + 7000 * 1000;
    } catch (error) {
      throw new Error(`Failed to refresh access token: ${error}`);
    }
  }

  private async initializeStream(): Promise<void> {
    // Stream SDK initialization would go here
    // This is a simplified implementation

    // In a real implementation, this would:
    // 1. Connect to DingTalk Stream endpoint
    // 2. Set up WebSocket or SSE connection
    // 3. Handle reconnection logic
    // 4. Parse incoming messages

    // For now, we'll simulate the connection
    this.simulateStreamConnection();
  }

  private simulateStreamConnection(): void {
    // This is a placeholder for actual Stream SDK integration
    // In production, use the official @dingtalk/chatbot or similar SDK

    const mockConnection = {
      close: () => Promise.resolve(),
      onMessage: (handler: (msg: DingTalkStreamMessage) => void) => {
        // Store handler for simulated messages
      },
    };

    this.streamConnection = mockConnection;
  }

  private async sendToConversation(
    conversationId: string,
    message: DingTalkMessage
  ): Promise<void> {
    if (!this.accessToken) {
      throw new Error("No access token available");
    }

    try {
      const response = await fetch(
        `https://oapi.dingtalk.com/chat/send?access_token=${this.accessToken}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatid: conversationId,
            msg: message,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status}`);
      }

      const data = (await response.json()) as any;

      if (data.errcode !== 0) {
        throw new Error(`DingTalk API error: ${data.errmsg}`);
      }
    } catch (error) {
      throw new Error(`Failed to send message: ${error}`);
    }
  }

  private async sendCardToConversation(
    conversationId: string,
    cardInstanceId: string,
    card: DingTalkAIStreamCard
  ): Promise<void> {
    // Implementation for sending interactive cards
    // This would use DingTalk's card API
  }

  private async updateCard(
    cardInstanceId: string,
    card: DingTalkAIStreamCard
  ): Promise<void> {
    // Implementation for updating streaming cards
    // This would use DingTalk's card update API
  }

  private handleStreamMessage(message: DingTalkStreamMessage): void {
    // Convert to GatewayMessage format
    const gatewayMessage: GatewayMessage = {
      id: message.messageId,
      platform: "dingtalk",
      channelId: message.conversationId,
      userId: message.senderUserId,
      userName: message.senderNick,
      text: message.text?.content || message.markdown?.text || "",
      timestamp: message.createAt,
      metadata: {
        conversationType: message.conversationType,
        conversationTitle: message.conversationTitle,
        senderCorpId: message.senderCorpId,
        robotCode: message.robotCode,
      },
    };

    this.handleMessage(gatewayMessage);
  }

  private findConversationByMessage(messageId: string): string | null {
    // In a real implementation, this would look up the conversation ID
    // from a message cache or database
    return null;
  }

  private escapeMarkdown(text: string): string {
    // Escape special Markdown characters for DingTalk
    return text
      .replace(/\\/g, "\\\\")
      .replace(/\*/g, "\\*")
      .replace(/_/g, "\\_")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)");
  }
}

/**
 * Create DingTalk gateway from configuration
 */
export function createDingTalkGateway(config: {
  appKey: string;
  appSecret: string;
  robotCode?: string;
  enabled?: boolean;
  allowlist?: string[];
  blocklist?: string[];
}): DingTalkGateway {
  return new DingTalkGateway({
    platform: "dingtalk",
    enabled: config.enabled ?? true,
    credentials: {
      appKey: config.appKey,
      appSecret: config.appSecret,
      robotCode: config.robotCode,
    },
    allowlist: config.allowlist,
    blocklist: config.blocklist,
  });
}
