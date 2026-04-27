// Feishu/Lark Gateway Implementation (P3-T2)

import { Gateway, GatewayConfig, GatewayMessage, GatewaySendOptions } from "./base.js";

// ─── Types ───────────────────────────────────────────────────────

export interface FeishuConfig extends GatewayConfig {
  platform: "feishu" | "lark";
  credentials: {
    /** App ID from Feishu/Lark developer console */
    appId: string;
    /** App Secret */
    appSecret: string;
    /** Encrypt key for webhook (optional) */
    encryptKey?: string;
    /** Verification token (optional) */
    verificationToken?: string;
  };
  /** Webhook URL for receiving messages */
  webhookPath?: string;
  /** Bot name (for @mentions) */
  botName?: string;
}

export interface FeishuMessageEvent {
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    sender: {
      sender_id: {
        open_id: string;
        union_id: string;
        user_id: string;
      };
      sender_type: string;
      tenant_key: string;
    };
    message: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      mentions?: Array<{
        key: string;
        id: {
          open_id: string;
          union_id: string;
          user_id: string;
        };
        name: string;
        tenant_key: string;
      }>;
    };
  };
}

// ─── Feishu Gateway ──────────────────────────────────────────────

export class FeishuGateway extends Gateway {
  private feishuConfig: FeishuConfig;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private webhookServer: any = null;

  constructor(config: FeishuConfig) {
    super(config);
    this.feishuConfig = config;
  }

  /**
   * Connect to Feishu/Lark.
   */
  async connect(): Promise<boolean> {
    try {
      // Get access token
      const token = await this.getAccessToken();
      if (!token) {
        throw new Error("Failed to obtain access token");
      }

      this.accessToken = token;
      this.connected = true;
      this.stats.connected = true;

      this.emit("connect");
      return true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }

  /**
   * Disconnect from Feishu/Lark.
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.stats.connected = false;

    if (this.webhookServer) {
      // Close webhook server if running
      this.webhookServer.close?.();
      this.webhookServer = null;
    }

    this.emit("disconnect");
  }

  /**
   * Send a message to a chat.
   */
  async sendMessage(
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    if (!this.connected || !this.accessToken) {
      throw new Error("Not connected to Feishu");
    }

    const token = await this.ensureToken();

    const body: Record<string, unknown> = {
      receive_id: channelId,
      content: JSON.stringify({ text }),
      msg_type: "text",
    };

    if (options?.replyTo) {
      body.reply_in_thread = true;
    }

    try {
      const response = await fetch("https://open.feishu.cn/open-apis/im/v1/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.status}`);
      }

      this.stats.messagesSent++;
      this.stats.lastActivity = Date.now();
    } catch (error) {
      this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * Handle incoming webhook from Feishu.
   */
  handleWebhook(payload: FeishuMessageEvent): void {
    // Verify token if configured
    if (this.feishuConfig.credentials.verificationToken) {
      if (payload.header.token !== this.feishuConfig.credentials.verificationToken) {
        this.handleError(new Error("Invalid verification token"));
        return;
      }
    }

    // Only handle message events
    if (payload.header.event_type !== "im.message.receive_v1") {
      return;
    }

    const event = payload.event;
    const message = event.message;

    // Parse message content
    let text = "";
    try {
      const content = JSON.parse(message.content);
      text = content.text || "";
    } catch {
      text = message.content;
    }

    // Remove @bot mention if present
    if (this.feishuConfig.botName && message.mentions) {
      for (const mention of message.mentions) {
        if (mention.name === this.feishuConfig.botName) {
          text = text.replace(mention.key, "").trim();
        }
      }
    }

    const gatewayMessage: GatewayMessage = {
      id: message.message_id,
      platform: this.feishuConfig.platform,
      channelId: message.chat_id,
      userId: event.sender.sender_id.open_id,
      userName: event.sender.sender_type, // Could be enriched with user info
      text,
      timestamp: parseInt(message.create_time),
      replyTo: message.parent_id,
      metadata: {
        chatType: message.chat_type,
        messageType: message.message_type,
      },
    };

    this.handleMessage(gatewayMessage);
  }

  /**
   * Send a verification response for webhook setup.
   */
  createVerificationResponse(challenge: string): { challenge: string } {
    return { challenge };
  }

  // ─── Private helpers ────────────────────────────────────────

  private async getAccessToken(): Promise<string | null> {
    try {
      const response = await fetch(
        "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            app_id: this.feishuConfig.credentials.appId,
            app_secret: this.feishuConfig.credentials.appSecret,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.status}`);
      }

      const data = await response.json() as {
        code: number;
        app_access_token?: string;
        expire?: number;
      };

      if (data.code !== 0 || !data.app_access_token) {
        throw new Error(`Token error: ${data.code}`);
      }

      // Set expiry with 5 minute buffer
      this.tokenExpiry = Date.now() + (data.expire || 7200) * 1000 - 300000;

      return data.app_access_token;
    } catch (error) {
      this.handleError(error as Error);
      return null;
    }
  }

  private async ensureToken(): Promise<string> {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      const token = await this.getAccessToken();
      if (!token) {
        throw new Error("Failed to refresh access token");
      }
      this.accessToken = token;
    }
    return this.accessToken;
  }
}

// ─── Factory ─────────────────────────────────────────────────────

export function createFeishuGateway(config: FeishuConfig): FeishuGateway {
  return new FeishuGateway(config);
}

export function createLarkGateway(config: Omit<FeishuConfig, "platform">): FeishuGateway {
  return new FeishuGateway({ ...config, platform: "lark" });
}
