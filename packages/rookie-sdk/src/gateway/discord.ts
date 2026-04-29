/**
 * Discord Gateway - Discord Bot 平台接入
 *
 * Features:
 * - discord.js integration
 * - Thread 隔离
 * - Slash Commands 支持
 * - Embed messages
 */

import { Gateway, GatewayConfig, GatewayMessage, GatewaySendOptions, GatewayStats } from "./base.js";

// Discord API types (simplified for webhook/bot API)
export interface DiscordConfig extends GatewayConfig {
  credentials: {
    botToken: string;
    applicationId: string;
    publicKey?: string;
  };
}

export interface DiscordInteraction {
  id: string;
  type: number;
  data?: DiscordApplicationCommandData;
  guild_id?: string;
  channel_id: string;
  member?: DiscordMember;
  user?: DiscordUser;
  token: string;
  version: number;
  message?: DiscordMessage;
}

interface DiscordApplicationCommandData {
  id: string;
  name: string;
  type: number;
  options?: DiscordApplicationCommandOption[];
}

interface DiscordApplicationCommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DiscordApplicationCommandOption[];
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  edited_timestamp?: string;
  thread?: DiscordChannel;
  mentions: DiscordUser[];
  mention_roles: string[];
  attachments: DiscordAttachment[];
  embeds: DiscordEmbed[];
  reactions?: DiscordReaction[];
  message_reference?: DiscordMessageReference;
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  global_name?: string;
  bot?: boolean;
}

interface DiscordMember {
  user?: DiscordUser;
  nick?: string;
  roles: string[];
}

interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  parent_id?: string;
  thread_metadata?: {
    archived: boolean;
    auto_archive_duration: number;
    archive_timestamp: string;
    locked?: boolean;
  };
}

interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string;
  size: number;
  url: string;
  proxy_url: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string;
  color?: number;
  footer?: { text: string; icon_url?: string };
  image?: { url: string };
  thumbnail?: { url: string };
  author?: { name: string; url?: string; icon_url?: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

interface DiscordReaction {
  count: number;
  me: boolean;
  emoji: { id?: string; name: string };
}

interface DiscordMessageReference {
  message_id?: string;
  channel_id?: string;
  guild_id?: string;
}

/**
 * Discord Gateway implementation
 */
export class DiscordGateway extends Gateway {
  private botToken: string;
  private applicationId: string;
  private sessionId?: string;
  private heartbeatInterval?: NodeJS.Timeout;
  private wsConnection?: WebSocket;
  private lastSequenceNumber?: number;

  constructor(config: DiscordConfig) {
    super(config);
    this.botToken = config.credentials.botToken;
    this.applicationId = config.credentials.applicationId;
  }

  /**
   * Connect to Discord Gateway
   */
  async connect(): Promise<boolean> {
    try {
      // Get gateway URL
      const gatewayInfo = await this.callAPI("gateway/bot");

      if (!gatewayInfo.url) {
        throw new Error("Failed to get gateway URL");
      }

      // Connect to WebSocket
      await this.connectWebSocket(gatewayInfo.url);

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
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.stats.connected = false;

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = undefined;
    }

    this.emit("disconnected");
  }

  /**
   * Send message to Discord channel
   */
  async sendMessage(
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    if (!this.connected) {
      throw new Error("Discord gateway not connected");
    }

    const payload: Record<string, any> = {
      content: text,
    };

    if (options?.replyTo) {
      payload.message_reference = {
        message_id: options.replyTo,
      };
    }

    await this.callAPI(`channels/${channelId}/messages`, "POST", payload);

    this.stats.messagesSent++;
    this.stats.lastActivity = Date.now();
  }

  /**
   * Send embed message
   */
  async sendEmbed(
    channelId: string,
    embed: DiscordEmbed,
    options?: GatewaySendOptions
  ): Promise<void> {
    const payload: Record<string, any> = {
      embeds: [embed],
    };

    if (options?.replyTo) {
      payload.message_reference = {
        message_id: options.replyTo,
      };
    }

    await this.callAPI(`channels/${channelId}/messages`, "POST", payload);
    this.stats.messagesSent++;
  }

  /**
   * Send rich message with components
   */
  async sendRichMessage(
    channelId: string,
    content: {
      content?: string;
      embeds?: DiscordEmbed[];
      components?: Array<{
        type: number;
        components: Array<{
          type: number;
          style?: number;
          label?: string;
          emoji?: { name: string };
          custom_id?: string;
          url?: string;
          disabled?: boolean;
        }>;
      }>;
    },
    options?: GatewaySendOptions
  ): Promise<void> {
    const payload = { ...content };

    if (options?.replyTo) {
      (payload as any).message_reference = {
        message_id: options.replyTo,
      };
    }

    await this.callAPI(`channels/${channelId}/messages`, "POST", payload);
    this.stats.messagesSent++;
  }

  /**
   * Create a thread
   */
  async createThread(
    channelId: string,
    name: string,
    options?: {
      messageId?: string;
      autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
      type?: number;
      invitable?: boolean;
      rateLimitPerUser?: number;
    }
  ): Promise<string> {
    let endpoint: string;
    let payload: Record<string, any> = {
      name,
      auto_archive_duration: options?.autoArchiveDuration ?? 1440,
    };

    if (options?.messageId) {
      // Create thread from message
      endpoint = `channels/${channelId}/messages/${options.messageId}/threads`;
    } else {
      // Create thread without message
      endpoint = `channels/${channelId}/threads`;
      payload.type = options?.type ?? 11;
      payload.invitable = options?.invitable ?? true;
      payload.rate_limit_per_user = options?.rateLimitPerUser ?? 0;
    }

    const result = await this.callAPI(endpoint, "POST", payload);
    return result.id;
  }

  /**
   * Send message to thread
   */
  async sendThreadMessage(
    threadId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    // Threads are just channels in Discord
    await this.sendMessage(threadId, text, options);
  }

  /**
   * Register slash commands
   */
  async registerSlashCommands(
    commands: Array<{
      name: string;
      description: string;
      options?: Array<{
        name: string;
        description: string;
        type: number;
        required?: boolean;
        choices?: Array<{ name: string; value: string | number }>;
      }>;
    }>,
    guildId?: string
  ): Promise<void> {
    const endpoint = guildId
      ? `applications/${this.applicationId}/guilds/${guildId}/commands`
      : `applications/${this.applicationId}/commands`;

    // Bulk overwrite commands
    await this.callAPI(endpoint, "PUT", commands);
  }

  /**
   * Reply to interaction (slash command)
   */
  async replyToInteraction(
    interactionId: string,
    interactionToken: string,
    response: {
      type: number;
      data?: {
        content?: string;
        embeds?: DiscordEmbed[];
        components?: any[];
        ephemeral?: boolean;
      };
    }
  ): Promise<void> {
    await fetch(
      `https://discord.com/api/v10/interactions/${interactionId}/${interactionToken}/callback`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(response),
      }
    );
  }

  /**
   * Edit original interaction response
   */
  async editInteractionResponse(
    interactionToken: string,
    content: {
      content?: string;
      embeds?: DiscordEmbed[];
      components?: any[];
    }
  ): Promise<void> {
    await this.callAPI(
      `webhooks/${this.applicationId}/${interactionToken}/messages/@original`,
      "PATCH",
      content
    );
  }

  /**
   * Add reaction to message
   */
  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string
  ): Promise<void> {
    const encodedEmoji = encodeURIComponent(emoji);
    await this.callAPI(
      `channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`,
      "PUT"
    );
  }

  /**
   * Delete message
   */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.callAPI(`channels/${channelId}/messages/${messageId}`, "DELETE");
  }

  /**
   * Pin message
   */
  async pinMessage(channelId: string, messageId: string): Promise<void> {
    await this.callAPI(`channels/${channelId}/pins/${messageId}`, "PUT");
  }

  /**
   * Handle webhook payload (for serverless deployments)
   */
  handleWebhookPayload(payload: DiscordInteraction): void {
    if (payload.type === 2) {
      // Application command (slash command)
      this.handleSlashCommand(payload);
    } else if (payload.type === 3) {
      // Message component interaction
      this.handleComponentInteraction(payload);
    }
  }

  // ─── Private Methods ────────────────────────────────────────────

  private async connectWebSocket(gatewayUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${gatewayUrl}/?v=10&encoding=json`);
      this.wsConnection = ws;

      ws.onopen = () => {
        // Send identify payload
        this.sendIdentify();
      };

      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        this.handleWebSocketPayload(payload);

        if (payload.op === 0 && payload.t === "READY") {
          this.sessionId = payload.d.session_id;
          resolve();
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };

      ws.onclose = () => {
        this.handleDisconnect();
      };
    });
  }

  private handleWebSocketPayload(payload: any): void {
    // Update sequence number
    if (payload.s) {
      this.lastSequenceNumber = payload.s;
    }

    switch (payload.op) {
      case 10: // Hello
        this.startHeartbeat(payload.d.heartbeat_interval);
        break;

      case 0: // Dispatch
        this.handleDispatch(payload.t, payload.d);
        break;

      case 11: // Heartbeat ACK
        // Heartbeat acknowledged
        break;

      case 1: // Heartbeat request
        this.sendHeartbeat();
        break;
    }
  }

  private handleDispatch(eventType: string, data: any): void {
    switch (eventType) {
      case "MESSAGE_CREATE":
        this.handleDiscordMessage(data as DiscordMessage);
        break;

      case "INTERACTION_CREATE":
        this.handleInteraction(data as DiscordInteraction);
        break;

      case "THREAD_CREATE":
        this.emit("thread:create", data);
        break;

      case "THREAD_UPDATE":
        this.emit("thread:update", data);
        break;

      case "THREAD_DELETE":
        this.emit("thread:delete", data);
        break;
    }
  }

  private handleDiscordMessage(message: DiscordMessage): void {
    // Ignore bot messages
    if (message.author.bot) {
      return;
    }

    const gatewayMessage: GatewayMessage = {
      id: message.id,
      platform: "discord",
      channelId: message.channel_id,
      userId: message.author.id,
      userName: message.author.global_name || message.author.username,
      text: message.content,
      timestamp: new Date(message.timestamp).getTime(),
      replyTo: message.message_reference?.message_id,
      metadata: {
        mentions: message.mentions.map((u) => u.id),
        mentionRoles: message.mention_roles,
        hasAttachments: message.attachments.length > 0,
        hasEmbeds: message.embeds.length > 0,
        thread: message.thread,
      },
    };

    this.handleMessage(gatewayMessage);
  }

  private handleInteraction(interaction: DiscordInteraction): void {
    this.emit("interaction", interaction);

    if (interaction.type === 2) {
      this.handleSlashCommand(interaction);
    }
  }

  private handleSlashCommand(interaction: DiscordInteraction): void {
    const gatewayMessage: GatewayMessage = {
      id: interaction.id,
      platform: "discord",
      channelId: interaction.channel_id,
      userId: interaction.user?.id || interaction.member?.user?.id || "",
      userName:
        interaction.user?.global_name ||
        interaction.user?.username ||
        interaction.member?.user?.global_name ||
        interaction.member?.user?.username ||
        "",
      text: `/${interaction.data?.name} ${this.formatCommandOptions(interaction.data?.options)}`,
      timestamp: Date.now(),
      metadata: {
        type: "slash_command",
        command: interaction.data?.name,
        options: interaction.data?.options,
        token: interaction.token,
      },
    };

    this.handleMessage(gatewayMessage);
  }

  private handleComponentInteraction(interaction: DiscordInteraction): void {
    this.emit("component_interaction", interaction);
  }

  private formatCommandOptions(
    options?: DiscordApplicationCommandOption[]
  ): string {
    if (!options) {
      return "";
    }

    return options
      .map((opt) => {
        const value =
          typeof opt.value === "string" ? opt.value : JSON.stringify(opt.value);
        return `${opt.name}:${value}`;
      })
      .join(" ");
  }

  private startHeartbeat(interval: number): void {
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, interval);
  }

  private sendHeartbeat(): void {
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(
        JSON.stringify({
          op: 1,
          d: this.lastSequenceNumber,
        })
      );
    }
  }

  private sendIdentify(): void {
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(
        JSON.stringify({
          op: 2,
          d: {
            token: this.botToken,
            intents: 33280, // GUILD_MESSAGES + MESSAGE_CONTENT + GUILDS
            properties: {
              os: process.platform,
              browser: "Rookie Agent",
              device: "Rookie Agent",
            },
          },
        })
      );
    }
  }

  private handleDisconnect(): void {
    if (this.connected) {
      // Attempt to reconnect
      setTimeout(() => {
        this.connect().catch(() => {});
      }, 5000);
    }
  }

  private async callAPI(
    endpoint: string,
    method: string = "GET",
    body?: any
  ): Promise<any> {
    const url = `https://discord.com/api/v10/${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bot ${this.botToken}`,
        "Content-Type": "application/json",
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Discord API error: ${response.status} - ${error}`);
    }

    // Return null for 204 No Content
    if (response.status === 204) {
      return null;
    }

    return response.json();
  }
}

/**
 * Create Discord gateway
 */
export function createDiscordGateway(config: {
  botToken: string;
  applicationId: string;
  publicKey?: string;
  enabled?: boolean;
  allowlist?: string[];
  blocklist?: string[];
}): DiscordGateway {
  return new DiscordGateway({
    platform: "discord",
    enabled: config.enabled ?? true,
    credentials: {
      botToken: config.botToken,
      applicationId: config.applicationId,
      publicKey: config.publicKey,
    },
    allowlist: config.allowlist,
    blocklist: config.blocklist,
  });
}
