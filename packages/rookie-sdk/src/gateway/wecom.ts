/**
 * WeCom Gateway - 企业微信平台接入
 *
 * Features:
 * - 回调验证 (Callback verification)
 * - 消息解密 (Message decryption)
 * - 应用消息模式 (Application message mode)
 * - 群机器人模式 (Group webhook mode)
 */

import { Gateway, GatewayConfig, GatewayMessage, GatewaySendOptions, GatewayStats } from "./base.js";
import { createHash, createDecipheriv } from "node:crypto";

// WeCom API types
export interface WeComConfig extends GatewayConfig {
  credentials: {
    corpId: string;
    agentId: string;
    secret: string;
    token?: string;
    encodingAESKey?: string;
    webhookKey?: string; // For group bot mode
  };
  mode?: "app" | "webhook"; // app = application mode, webhook = group bot mode
}

export interface WeComMessage {
  msgtype: string;
  text?: {
    content: string;
    mentioned_list?: string[];
    mentioned_mobile_list?: string[];
  };
  markdown?: {
    content: string;
  };
  news?: {
    articles: Array<{
      title: string;
      description: string;
      url: string;
      picurl?: string;
    }>;
  };
  file?: {
    media_id: string;
  };
  image?: {
    base64: string;
    md5: string;
  };
  voice?: {
    media_id: string;
  };
  video?: {
    media_id: string;
    title?: string;
    description?: string;
  };
  template_card?: {
    card_type: string;
    source?: {
      desc: string;
      desc_color?: number;
    };
    main_title?: {
      title: string;
      desc?: string;
    };
    emphasis_content?: {
      title: string;
      desc?: string;
    };
    sub_title_text?: string;
    jump_list?: Array<{
      type: number;
      url: string;
      title: string;
    }>;
    card_action?: {
      type: number;
      url: string;
    };
  };
}

export interface WeComCallbackMessage {
  ToUserName: string;
  FromUserName: string;
  CreateTime: number;
  MsgType: string;
  Content?: string;
  MsgId?: number;
  AgentID?: string;
  PicUrl?: string;
  MediaId?: string;
  Format?: string;
  ThumbMediaId?: string;
  Location_X?: number;
  Location_Y?: number;
  Scale?: number;
  Label?: string;
  Title?: string;
  Description?: string;
  Event?: string;
  EventKey?: string;
}

/**
 * WeCom Gateway implementation
 */
export class WeComGateway extends Gateway {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;
  private mode: "app" | "webhook";

  constructor(config: WeComConfig) {
    super(config);
    this.mode = config.mode ?? "app";
  }

  /**
   * Connect to WeCom
   */
  async connect(): Promise<boolean> {
    try {
      if (this.mode === "app") {
        await this.refreshAccessToken();
      }

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
   * Disconnect from WeCom
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.stats.connected = false;
    this.accessToken = null;
    this.emit("disconnected");
  }

  /**
   * Send message to WeCom
   */
  async sendMessage(
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    if (!this.connected) {
      throw new Error("WeCom gateway not connected");
    }

    if (this.mode === "app") {
      await this.sendAppMessage(channelId, text, options);
    } else {
      await this.sendWebhookMessage(text, options);
    }

    this.stats.messagesSent++;
    this.stats.lastActivity = Date.now();
  }

  /**
   * Send application message
   */
  async sendAppMessage(
    userId: string,
    text: string,
    options?: GatewaySendOptions & {
      msgType?: "text" | "markdown" | "news" | "template_card";
    }
  ): Promise<void> {
    if (this.mode !== "app") {
      throw new Error("App mode required for sendAppMessage");
    }

    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    const msgType = options?.msgType ?? "text";
    const message: WeComMessage = { msgtype: "text" };

    switch (msgType) {
      case "text":
        message.msgtype = "text";
        message.text = { content: text };
        break;
      case "markdown":
        message.msgtype = "markdown";
        message.markdown = { content: text };
        break;
      case "template_card":
        message.msgtype = "template_card";
        message.template_card = {
          card_type: "text_notice",
          main_title: { title: text },
        };
        break;
      default:
        message.msgtype = "text";
        message.text = { content: text };
    }

    await this.callMessageSendAPI(userId, message);
  }

  /**
   * Send group message via webhook (群机器人)
   */
  async sendWebhookMessage(
    text: string,
    options?: GatewaySendOptions & {
      msgType?: "text" | "markdown" | "news" | "template_card";
      mentionedList?: string[];
      mentionedMobileList?: string[];
    }
  ): Promise<void> {
    if (this.mode !== "webhook") {
      throw new Error("Webhook mode required for sendWebhookMessage");
    }

    const { webhookKey } = this.config.credentials as { webhookKey: string };
    const msgType = options?.msgType ?? "text";

    const message: WeComMessage = { msgtype: "text" };

    switch (msgType) {
      case "text":
        message.msgtype = "text";
        message.text = {
          content: text,
          mentioned_list: options?.mentionedList,
          mentioned_mobile_list: options?.mentionedMobileList,
        };
        break;
      case "markdown":
        message.msgtype = "markdown";
        message.markdown = { content: text };
        break;
      case "news":
        message.msgtype = "news";
        message.news = {
          articles: [
            {
              title: "Rookie Agent",
              description: text,
              url: "https://github.com/rookie-agent",
            },
          ],
        };
        break;
      case "template_card":
        message.msgtype = "template_card";
        message.template_card = {
          card_type: "text_notice",
          source: { desc: "Rookie Agent" },
          main_title: { title: text },
        };
        break;
      default:
        message.msgtype = "text";
        message.text = { content: text };
    }

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${webhookKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(message),
      }
    );

    if (!response.ok) {
      throw new Error(`Webhook send failed: ${response.status}`);
    }

    const data = (await response.json()) as any;
    if (data.errcode !== 0) {
      throw new Error(`WeCom API error: ${data.errmsg}`);
    }
  }

  /**
   * Send message to group
   */
  async sendGroupMessage(
    groupId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    if (this.mode !== "app") {
      throw new Error("App mode required for group messages");
    }

    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    const message: WeComMessage = options?.markdown
      ? {
          msgtype: "markdown",
          markdown: { content: text },
        }
      : {
          msgtype: "text",
          text: { content: text },
        };

    await this.callAppChatSendAPI(groupId, message);
  }

  /**
   * Verify callback URL
   */
  verifyCallback(
    signature: string,
    timestamp: string,
    nonce: string,
    echostr: string
  ): string | null {
    const { token } = this.config.credentials as { token?: string };
    if (!token) {
      return null;
    }

    const computedSignature = this.computeSignature(token, timestamp, nonce, echostr);

    if (computedSignature === signature) {
      return echostr;
    }

    return null;
  }

  /**
   * Decrypt callback message
   */
  decryptMessage(encryptedMsg: string): string | null {
    const { encodingAESKey } = this.config.credentials as { encodingAESKey?: string };
    if (!encodingAESKey) {
      return null;
    }

    try {
      return this.decrypt(encryptedMsg, encodingAESKey);
    } catch {
      return null;
    }
  }

  /**
   * Parse and handle callback message
   */
  handleCallbackMessage(xmlData: string): GatewayMessage | null {
    try {
      // Simple XML parsing (in production, use a proper XML parser)
      const msg = this.parseXml(xmlData) as WeComCallbackMessage;

      if (!msg.FromUserName || !msg.MsgType) {
        return null;
      }

      const gatewayMessage: GatewayMessage = {
        id: msg.MsgId?.toString() || `${Date.now()}`,
        platform: "wecom",
        channelId: msg.AgentID || "default",
        userId: msg.FromUserName,
        userName: msg.FromUserName, // WeCom doesn't provide nickname in callback
        text: msg.Content || "",
        timestamp: msg.CreateTime * 1000,
        metadata: {
          msgType: msg.MsgType,
          event: msg.Event,
          eventKey: msg.EventKey,
        },
      };

      this.handleMessage(gatewayMessage);
      return gatewayMessage;
    } catch (error) {
      this.handleError(error as Error);
      return null;
    }
  }

  /**
   * Upload media file
   */
  async uploadMedia(
    mediaType: "image" | "voice" | "video" | "file",
    fileData: Buffer,
    filename: string
  ): Promise<string> {
    if (this.mode !== "app") {
      throw new Error("App mode required for media upload");
    }

    if (Date.now() >= this.tokenExpiresAt) {
      await this.refreshAccessToken();
    }

    const formData = new FormData();
    const blob = new Blob([fileData]);
    formData.append("media", blob, filename);

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${this.accessToken}&type=${mediaType}`,
      {
        method: "POST",
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error(`Media upload failed: ${response.status}`);
    }

    const data = (await response.json()) as any;
    if (data.errcode !== 0) {
      throw new Error(`WeCom API error: ${data.errmsg}`);
    }

    return data.media_id;
  }

  // ─── Private Methods ────────────────────────────────────────────

  private async refreshAccessToken(): Promise<void> {
    const { corpId, secret } = this.config.credentials as { corpId: string; secret: string };

    try {
      const response = await fetch(
        `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`
      );

      if (!response.ok) {
        throw new Error(`Failed to get access token: ${response.status}`);
      }

      const data = (await response.json()) as any;

      if (data.errcode !== 0) {
        throw new Error(`WeCom API error: ${data.errmsg}`);
      }

      this.accessToken = data.access_token;
      // Token expires in 7200 seconds, refresh after 7000
      this.tokenExpiresAt = Date.now() + 7000 * 1000;
    } catch (error) {
      throw new Error(`Failed to refresh access token: ${error}`);
    }
  }

  private async callMessageSendAPI(userId: string, message: WeComMessage): Promise<void> {
    if (!this.accessToken) {
      throw new Error("No access token available");
    }

    const { agentId } = this.config.credentials as { agentId: string };

    const payload = {
      touser: userId,
      agentid: parseInt(agentId, 10),
      safe: 0,
      ...message,
    };

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${this.accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`Message send failed: ${response.status}`);
    }

    const data = (await response.json()) as any;
    if (data.errcode !== 0) {
      throw new Error(`WeCom API error: ${data.errmsg}`);
    }
  }

  private async callAppChatSendAPI(groupId: string, message: WeComMessage): Promise<void> {
    if (!this.accessToken) {
      throw new Error("No access token available");
    }

    const payload = {
      chatid: groupId,
      safe: 0,
      ...message,
    };

    const response = await fetch(
      `https://qyapi.weixin.qq.com/cgi-bin/appchat/send?access_token=${this.accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      throw new Error(`Group message send failed: ${response.status}`);
    }

    const data = (await response.json()) as any;
    if (data.errcode !== 0) {
      throw new Error(`WeCom API error: ${data.errmsg}`);
    }
  }

  private computeSignature(
    token: string,
    timestamp: string,
    nonce: string,
    echostr: string
  ): string {
    const params = [token, timestamp, nonce, echostr].sort();
    const str = params.join("");
    return createHash("sha1").update(str).digest("hex");
  }

  private decrypt(encryptedMsg: string, encodingAESKey: string): string {
    // Decode base64 encodingAESKey
    const aesKey = Buffer.from(encodingAESKey + "=", "base64");

    // Decode encrypted message
    const encryptedBuffer = Buffer.from(encryptedMsg, "base64");

    // Decrypt using AES-256-CBC
    const iv = aesKey.slice(0, 16);
    const decipher = createDecipheriv("aes-256-cbc", aesKey, iv);

    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    // Remove random bytes and get message length
    const msgLength = decrypted.readUInt32BE(16);
    const msg = decrypted.slice(20, 20 + msgLength);

    return msg.toString("utf-8");
  }

  private parseXml(xmlData: string): Record<string, any> {
    // Simple XML parser (in production, use fast-xml-parser or similar)
    const result: Record<string, any> = {};

    const tagRegex = /<(\w+)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\w+>/g;
    let match;

    while ((match = tagRegex.exec(xmlData)) !== null) {
      const [, tag, value] = match;
      result[tag] = value;
    }

    return result;
  }
}

/**
 * Create WeCom gateway for application mode
 */
export function createWeComAppGateway(config: {
  corpId: string;
  agentId: string;
  secret: string;
  token?: string;
  encodingAESKey?: string;
  enabled?: boolean;
  allowlist?: string[];
  blocklist?: string[];
}): WeComGateway {
  return new WeComGateway({
    platform: "wecom",
    enabled: config.enabled ?? true,
    mode: "app",
    credentials: {
      corpId: config.corpId,
      agentId: config.agentId,
      secret: config.secret,
      token: config.token,
      encodingAESKey: config.encodingAESKey,
    },
    allowlist: config.allowlist,
    blocklist: config.blocklist,
  });
}

/**
 * Create WeCom gateway for webhook/bot mode
 */
export function createWeComWebhookGateway(config: {
  webhookKey: string;
  enabled?: boolean;
}): WeComGateway {
  return new WeComGateway({
    platform: "wecom-webhook",
    enabled: config.enabled ?? true,
    mode: "webhook",
    credentials: {
      corpId: "",
      agentId: "",
      secret: "",
      webhookKey: config.webhookKey,
    },
  });
}
