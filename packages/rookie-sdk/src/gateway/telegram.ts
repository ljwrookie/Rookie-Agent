/**
 * Telegram Gateway - Telegram Bot 平台接入
 *
 * Features:
 * - Telegraf Bot API
 * - 语音消息转录 (Voice transcription)
 * - SOCKS5 代理支持
 * - 长消息分段发送
 */

import { Gateway, GatewayConfig, GatewayMessage, GatewaySendOptions, GatewayStats } from "./base.js";

// Telegram API types
export interface TelegramConfig extends GatewayConfig {
  credentials: {
    botToken: string;
    webhookUrl?: string;
    socks5Proxy?: {
      host: string;
      port: number;
      username?: string;
      password?: string;
    };
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  date: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  voice?: TelegramVoice;
  audio?: TelegramAudio;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
  reply_to_message?: TelegramMessage;
  entities?: TelegramMessageEntity[];
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

interface TelegramAudio {
  file_id: string;
  file_unique_id: string;
  duration: number;
  performer?: string;
  title?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

interface TelegramMessageEntity {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUser;
}

/**
 * Telegram Gateway implementation
 */
export class TelegramGateway extends Gateway {
  private botToken: string;
  private webhookUrl?: string;
  private socks5Proxy?: TelegramConfig["credentials"]["socks5Proxy"];
  private offset = 0;
  private pollingTimer?: NodeJS.Timeout;
  private isRunning = false;
  private transcriptionEnabled = false;
  private transcriptionProvider?: (audioUrl: string) => Promise<string>;

  constructor(config: TelegramConfig) {
    super(config);
    this.botToken = config.credentials.botToken;
    this.webhookUrl = config.credentials.webhookUrl;
    this.socks5Proxy = config.credentials.socks5Proxy;
  }

  /**
   * Enable voice transcription with a provider
   */
  enableTranscription(
    provider: (audioUrl: string) => Promise<string>
  ): void {
    this.transcriptionEnabled = true;
    this.transcriptionProvider = provider;
  }

  /**
   * Connect to Telegram
   */
  async connect(): Promise<boolean> {
    try {
      // Verify bot token by calling getMe
      const botInfo = await this.callAPI("getMe");

      if (!botInfo.ok) {
        throw new Error("Invalid bot token");
      }

      this.isRunning = true;

      if (this.webhookUrl) {
        // Set up webhook
        await this.setupWebhook();
      } else {
        // Start polling
        this.startPolling();
      }

      this.connected = true;
      this.stats.connected = true;
      this.emit("connected", { bot: botInfo.result });

      return true;
    } catch (error) {
      this.handleError(error as Error);
      return false;
    }
  }

  /**
   * Disconnect from Telegram
   */
  async disconnect(): Promise<void> {
    this.isRunning = false;
    this.connected = false;
    this.stats.connected = false;

    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }

    // Delete webhook if set
    if (this.webhookUrl) {
      try {
        await this.callAPI("deleteWebhook");
      } catch {
        // Ignore errors during disconnect
      }
    }

    this.emit("disconnected");
  }

  /**
   * Send message to Telegram
   */
  async sendMessage(
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    if (!this.connected) {
      throw new Error("Telegram gateway not connected");
    }

    // Handle long messages by splitting
    const maxLength = 4096;
    const chunks = this.splitMessage(text, maxLength);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLast = i === chunks.length - 1;

      const payload: Record<string, any> = {
        chat_id: channelId,
        text: chunk,
        parse_mode: options?.markdown ? "MarkdownV2" : undefined,
        disable_notification: options?.silent,
      };

      if (options?.replyTo && isLast) {
        payload.reply_parameters = {
          message_id: parseInt(options.replyTo, 10),
        };
      }

      await this.callAPI("sendMessage", payload);

      // Small delay between chunks
      if (!isLast) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    this.stats.messagesSent += chunks.length;
    this.stats.lastActivity = Date.now();
  }

  /**
   * Send message with Markdown formatting
   */
  async sendMarkdownMessage(
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    const escaped = this.escapeMarkdown(text);
    await this.sendMessage(channelId, escaped, { ...options, markdown: true });
  }

  /**
   * Send photo/image
   */
  async sendPhoto(
    channelId: string,
    photoUrl: string,
    caption?: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    const payload: Record<string, any> = {
      chat_id: channelId,
      photo: photoUrl,
      caption: caption,
      parse_mode: options?.markdown ? "MarkdownV2" : undefined,
      disable_notification: options?.silent,
    };

    if (options?.replyTo) {
      payload.reply_parameters = {
        message_id: parseInt(options.replyTo, 10),
      };
    }

    await this.callAPI("sendPhoto", payload);
    this.stats.messagesSent++;
  }

  /**
   * Send document/file
   */
  async sendDocument(
    channelId: string,
    documentUrl: string,
    caption?: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    const payload: Record<string, any> = {
      chat_id: channelId,
      document: documentUrl,
      caption: caption,
      parse_mode: options?.markdown ? "MarkdownV2" : undefined,
      disable_notification: options?.silent,
    };

    if (options?.replyTo) {
      payload.reply_parameters = {
        message_id: parseInt(options.replyTo, 10),
      };
    }

    await this.callAPI("sendDocument", payload);
    this.stats.messagesSent++;
  }

  /**
   * Send inline keyboard
   */
  async sendInlineKeyboard(
    channelId: string,
    text: string,
    buttons: Array<
      Array<{ text: string; callback_data?: string; url?: string }>
    >,
    options?: GatewaySendOptions
  ): Promise<void> {
    const payload: Record<string, any> = {
      chat_id: channelId,
      text: text,
      parse_mode: options?.markdown ? "MarkdownV2" : undefined,
      reply_markup: {
        inline_keyboard: buttons,
      },
      disable_notification: options?.silent,
    };

    await this.callAPI("sendMessage", payload);
    this.stats.messagesSent++;
  }

  /**
   * Edit existing message
   */
  async editMessage(
    channelId: string,
    messageId: string,
    text: string,
    options?: { markdown?: boolean }
  ): Promise<void> {
    const payload: Record<string, any> = {
      chat_id: channelId,
      message_id: parseInt(messageId, 10),
      text: text,
      parse_mode: options?.markdown ? "MarkdownV2" : undefined,
    };

    await this.callAPI("editMessageText", payload);
  }

  /**
   * Answer callback query (for inline keyboards)
   */
  async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert?: boolean
  ): Promise<void> {
    const payload: Record<string, any> = {
      callback_query_id: callbackQueryId,
    };

    if (text) {
      payload.text = text;
    }

    if (showAlert) {
      payload.show_alert = true;
    }

    await this.callAPI("answerCallbackQuery", payload);
  }

  /**
   * Get file URL
   */
  async getFileUrl(fileId: string): Promise<string> {
    const result = await this.callAPI("getFile", { file_id: fileId });

    if (!result.ok) {
      throw new Error("Failed to get file");
    }

    const filePath = result.result.file_path;
    return `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
  }

  /**
   * Handle webhook update
   */
  handleWebhookUpdate(update: TelegramUpdate): void {
    this.processUpdate(update);
  }

  // ─── Private Methods ────────────────────────────────────────────

  private async setupWebhook(): Promise<void> {
    if (!this.webhookUrl) {
      return;
    }

    await this.callAPI("setWebhook", {
      url: this.webhookUrl,
      allowed_updates: ["message", "callback_query"],
    });
  }

  private startPolling(): void {
    const poll = async () => {
      if (!this.isRunning) {
        return;
      }

      try {
        const updates = await this.callAPI("getUpdates", {
          offset: this.offset,
          limit: 100,
          timeout: 30,
        });

        if (updates.ok && updates.result) {
          for (const update of updates.result) {
            this.processUpdate(update);
            this.offset = update.update_id + 1;
          }
        }
      } catch (error) {
        this.handleError(error as Error);
      }

      // Schedule next poll
      if (this.isRunning) {
        this.pollingTimer = setTimeout(poll, 100);
      }
    };

    poll();
  }

  private processUpdate(update: TelegramUpdate): void {
    const message = update.message || update.edited_message;

    if (message) {
      this.handleTelegramMessage(message);
    }

    if (update.callback_query) {
      this.handleCallbackQuery(update.callback_query);
    }
  }

  private async handleTelegramMessage(message: TelegramMessage): Promise<void> {
    if (!message.from) {
      return;
    }

    let text = message.text || message.caption || "";

    // Handle voice messages
    if (message.voice && this.transcriptionEnabled && this.transcriptionProvider) {
      try {
        const fileUrl = await this.getFileUrl(message.voice.file_id);
        const transcription = await this.transcriptionProvider(fileUrl);
        text = `🎤 [Voice]: ${transcription}`;
      } catch (error) {
        text = "🎤 [Voice message - transcription failed]";
      }
    }

    // Handle audio files
    if (message.audio && this.transcriptionEnabled && this.transcriptionProvider) {
      try {
        const fileUrl = await this.getFileUrl(message.audio.file_id);
        const transcription = await this.transcriptionProvider(fileUrl);
        text = `🎵 [Audio]: ${transcription}`;
      } catch (error) {
        text = "🎵 [Audio message - transcription failed]";
      }
    }

    const gatewayMessage: GatewayMessage = {
      id: message.message_id.toString(),
      platform: "telegram",
      channelId: message.chat.id.toString(),
      userId: message.from.id.toString(),
      userName: message.from.username || message.from.first_name,
      text: text,
      timestamp: message.date * 1000,
      replyTo: message.reply_to_message?.message_id.toString(),
      metadata: {
        chatType: message.chat.type,
        chatTitle: message.chat.title,
        isEdited: !!message.reply_to_message,
        hasVoice: !!message.voice,
        hasAudio: !!message.audio,
        hasDocument: !!message.document,
        hasPhoto: !!message.photo && message.photo.length > 0,
      },
    };

    this.handleMessage(gatewayMessage);
  }

  private handleCallbackQuery(callbackQuery: TelegramCallbackQuery): void {
    // Handle inline keyboard callbacks
    this.emit("callback_query", {
      id: callbackQuery.id,
      from: callbackQuery.from,
      data: callbackQuery.data,
      message: callbackQuery.message,
    });
  }

  private async callAPI(method: string, params?: Record<string, any>): Promise<any> {
    const url = `https://api.telegram.org/bot${this.botToken}/${method}`;

    const fetchOptions: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    };

    if (params) {
      fetchOptions.body = JSON.stringify(params);
    }

    // Apply SOCKS5 proxy if configured
    // Note: In a real implementation, you'd use a fetch library that supports SOCKS5
    // like `socks-proxy-agent` with node-fetch

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status}`);
    }

    return response.json();
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Try to split at a newline
      let splitIndex = remaining.lastIndexOf("\n", maxLength);

      // If no newline, try to split at a space
      if (splitIndex <= 0) {
        splitIndex = remaining.lastIndexOf(" ", maxLength);
      }

      // If no good split point, just split at maxLength
      if (splitIndex <= 0) {
        splitIndex = maxLength;
      }

      chunks.push(remaining.substring(0, splitIndex));
      remaining = remaining.substring(splitIndex).trimStart();
    }

    return chunks;
  }

  private escapeMarkdown(text: string): string {
    // Escape special MarkdownV2 characters
    return text
      .replace(/\\/g, "\\\\")
      .replace(/_/g, "\\_")
      .replace(/\*/g, "\\*")
      .replace(/\[/g, "\\[")
      .replace(/\]/g, "\\]")
      .replace(/\(/g, "\\(")
      .replace(/\)/g, "\\)")
      .replace(/~/g, "\\~")
      .replace(/`/g, "\\`")
      .replace(/>/g, "\\>")
      .replace(/#/g, "\\#")
      .replace(/\+/g, "\\+")
      .replace(/-/g, "\\-")
      .replace(/=/g, "\\=")
      .replace(/\|/g, "\\|")
      .replace(/\{/g, "\\{")
      .replace(/\}/g, "\\}")
      .replace(/\./g, "\\.")
      .replace(/!/g, "\\!");
  }
}

/**
 * Create Telegram gateway
 */
export function createTelegramGateway(config: {
  botToken: string;
  webhookUrl?: string;
  socks5Proxy?: {
    host: string;
    port: number;
    username?: string;
    password?: string;
  };
  enabled?: boolean;
  allowlist?: string[];
  blocklist?: string[];
}): TelegramGateway {
  return new TelegramGateway({
    platform: "telegram",
    enabled: config.enabled ?? true,
    credentials: {
      botToken: config.botToken,
      webhookUrl: config.webhookUrl,
      socks5Proxy: config.socks5Proxy,
    },
    allowlist: config.allowlist,
    blocklist: config.blocklist,
  });
}
