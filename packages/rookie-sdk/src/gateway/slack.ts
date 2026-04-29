/**
 * Slack Gateway - Slack Bot 平台接入
 *
 * Features:
 * - @slack/bolt integration
 * - Thread support
 * - Block Kit UI
 * - Socket Mode
 */

import { Gateway, GatewayConfig, GatewayMessage, GatewaySendOptions, GatewayStats } from "./base.js";

// Slack API types
export interface SlackConfig extends GatewayConfig {
  credentials: {
    botToken: string;
    signingSecret: string;
    appToken?: string; // For Socket Mode
    webhookUrl?: string; // For incoming webhooks
  };
  socketMode?: boolean;
}

export interface SlackEvent {
  type: string;
  user?: string;
  channel?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  team?: string;
  event_ts?: string;
  channel_type?: string;
  bot_id?: string;
  subtype?: string;
  files?: SlackFile[];
  attachments?: SlackAttachment[];
  blocks?: SlackBlock[];
}

interface SlackFile {
  id: string;
  created: number;
  timestamp: number;
  name: string;
  title: string;
  mimetype: string;
  filetype: string;
  url_private: string;
  url_private_download: string;
}

export interface SlackAttachment {
  fallback: string;
  color?: string;
  pretext?: string;
  author_name?: string;
  author_link?: string;
  author_icon?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
  image_url?: string;
  thumb_url?: string;
  footer?: string;
  footer_icon?: string;
  ts?: number;
}

export interface SlackBlock {
  type: string;
  block_id?: string;
  // Block Kit is heterogeneous; keep this permissive for callers.
  [key: string]: any;
}

interface SlackUser {
  id: string;
  team_id?: string;
  name: string;
  real_name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    image_48?: string;
  };
  is_bot?: boolean;
}

interface SlackChannel {
  id: string;
  name: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
}

export interface SlackCommandRequest {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
}

interface SlackAction {
  action_id: string;
  block_id: string;
  text?: { type: string; text: string; emoji?: boolean };
  value?: string;
  type: string;
  action_ts: string;
}

/**
 * Slack Gateway implementation
 */
export class SlackGateway extends Gateway {
  private botToken: string;
  private signingSecret: string;
  private appToken?: string;
  private webhookUrl?: string;
  private socketMode: boolean;
  private socketConnection?: WebSocket;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(config: SlackConfig) {
    super(config);
    this.botToken = config.credentials.botToken;
    this.signingSecret = config.credentials.signingSecret;
    this.appToken = config.credentials.appToken;
    this.webhookUrl = config.credentials.webhookUrl;
    this.socketMode = config.socketMode ?? false;
  }

  /**
   * Connect to Slack
   */
  async connect(): Promise<boolean> {
    try {
      if (this.socketMode && this.appToken) {
        await this.connectSocketMode();
      } else {
        // HTTP mode - just verify token
        await this.verifyToken();
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
   * Disconnect from Slack
   */
  async disconnect(): Promise<void> {
    this.connected = false;
    this.stats.connected = false;

    if (this.socketConnection) {
      this.socketConnection.close();
      this.socketConnection = undefined;
    }

    this.emit("disconnected");
  }

  /**
   * Send message to Slack
   */
  async sendMessage(
    channelId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    if (!this.connected) {
      throw new Error("Slack gateway not connected");
    }

    const payload: Record<string, any> = {
      channel: channelId,
      text: text,
    };

    if (options?.threadId) {
      payload.thread_ts = options.threadId;
    }

    if (options?.replyTo) {
      payload.thread_ts = options.replyTo;
    }

    await this.callAPI("chat.postMessage", payload);

    this.stats.messagesSent++;
    this.stats.lastActivity = Date.now();
  }

  /**
   * Send Block Kit message
   */
  async sendBlockMessage(
    channelId: string,
    blocks: SlackBlock[],
    options?: GatewaySendOptions & { text?: string }
  ): Promise<void> {
    const payload: Record<string, any> = {
      channel: channelId,
      blocks: blocks,
      text: options?.text || "Message with blocks",
    };

    if (options?.threadId) {
      payload.thread_ts = options.threadId;
    }

    await this.callAPI("chat.postMessage", payload);
    this.stats.messagesSent++;
  }

  /**
   * Send message with attachments (legacy)
   */
  async sendAttachmentMessage(
    channelId: string,
    attachments: SlackAttachment[],
    options?: GatewaySendOptions & { text?: string }
  ): Promise<void> {
    const payload: Record<string, any> = {
      channel: channelId,
      attachments: attachments,
      text: options?.text || "",
    };

    if (options?.threadId) {
      payload.thread_ts = options.threadId;
    }

    await this.callAPI("chat.postMessage", payload);
    this.stats.messagesSent++;
  }

  /**
   * Send ephemeral message (only visible to specific user)
   */
  async sendEphemeralMessage(
    channelId: string,
    userId: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    const payload: Record<string, any> = {
      channel: channelId,
      user: userId,
      text: text,
    };

    if (options?.threadId) {
      payload.thread_ts = options.threadId;
    }

    await this.callAPI("chat.postEphemeral", payload);
    this.stats.messagesSent++;
  }

  /**
   * Reply in thread
   */
  async replyInThread(
    channelId: string,
    threadTs: string,
    text: string,
    options?: GatewaySendOptions
  ): Promise<void> {
    await this.sendMessage(channelId, text, { ...options, threadId: threadTs });
  }

  /**
   * Update existing message
   */
  async updateMessage(
    channelId: string,
    timestamp: string,
    text: string,
    options?: { blocks?: SlackBlock[] }
  ): Promise<void> {
    const payload: Record<string, any> = {
      channel: channelId,
      ts: timestamp,
      text: text,
    };

    if (options?.blocks) {
      payload.blocks = options.blocks;
    }

    await this.callAPI("chat.update", payload);
  }

  /**
   * Delete message
   */
  async deleteMessage(channelId: string, timestamp: string): Promise<void> {
    await this.callAPI("chat.delete", {
      channel: channelId,
      ts: timestamp,
    });
  }

  /**
   * Add reaction
   */
  async addReaction(
    channelId: string,
    timestamp: string,
    emoji: string
  ): Promise<void> {
    await this.callAPI("reactions.add", {
      channel: channelId,
      timestamp: timestamp,
      name: emoji.replace(/:/g, ""),
    });
  }

  /**
   * Get thread replies
   */
  async getThreadReplies(
    channelId: string,
    threadTs: string
  ): Promise<SlackEvent[]> {
    const result = await this.callAPI("conversations.replies", {
      channel: channelId,
      ts: threadTs,
    });

    return result.messages || [];
  }

  /**
   * Open DM channel
   */
  async openDM(userId: string): Promise<string> {
    const result = await this.callAPI("conversations.open", {
      users: userId,
    });

    return result.channel.id;
  }

  /**
   * Get user info
   */
  async getUserInfo(userId: string): Promise<SlackUser> {
    const result = await this.callAPI("users.info", {
      user: userId,
    });

    return result.user;
  }

  /**
   * Get channel info
   */
  async getChannelInfo(channelId: string): Promise<SlackChannel> {
    const result = await this.callAPI("conversations.info", {
      channel: channelId,
    });

    return result.channel;
  }

  /**
   * Upload file
   */
  async uploadFile(
    channelId: string,
    fileData: Buffer,
    filename: string,
    options?: { title?: string; threadTs?: string }
  ): Promise<void> {
    const formData = new FormData();
    const blob = new Blob([fileData]);
    formData.append("file", blob, filename);
    formData.append("channels", channelId);

    if (options?.title) {
      formData.append("title", options.title);
    }

    if (options?.threadTs) {
      formData.append("thread_ts", options.threadTs);
    }

    await fetch("https://slack.com/api/files.upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
      },
      body: formData,
    });
  }

  /**
   * Handle slash command
   */
  handleSlashCommand(command: SlackCommandRequest): void {
    const gatewayMessage: GatewayMessage = {
      id: `cmd_${Date.now()}`,
      platform: "slack",
      channelId: command.channel_id,
      userId: command.user_id,
      userName: command.user_name,
      text: `${command.command} ${command.text}`.trim(),
      timestamp: Date.now(),
      metadata: {
        type: "slash_command",
        command: command.command,
        responseUrl: command.response_url,
        triggerId: command.trigger_id,
        teamId: command.team_id,
      },
    };

    this.handleMessage(gatewayMessage);
  }

  /**
   * Handle block action
   */
  handleBlockAction(payload: {
    user: { id: string; username: string };
    channel: { id: string; name: string };
    message?: { ts: string };
    actions: SlackAction[];
    response_url: string;
  }): void {
    const action = payload.actions[0];

    const gatewayMessage: GatewayMessage = {
      id: `action_${Date.now()}`,
      platform: "slack",
      channelId: payload.channel.id,
      userId: payload.user.id,
      userName: payload.user.username,
      text: `Action: ${action.action_id}`,
      timestamp: Date.now(),
      metadata: {
        type: "block_action",
        actionId: action.action_id,
        blockId: action.block_id,
        value: action.value,
        responseUrl: payload.response_url,
      },
    };

    this.handleMessage(gatewayMessage);
  }

  /**
   * Send webhook response (for slash commands/interactions)
   */
  async sendWebhookResponse(
    responseUrl: string,
    response: {
      text?: string;
      blocks?: SlackBlock[];
      attachments?: SlackAttachment[];
      response_type?: "in_channel" | "ephemeral";
      replace_original?: boolean;
      delete_original?: boolean;
    }
  ): Promise<void> {
    await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response),
    });
  }

  /**
   * Handle incoming webhook event
   */
  handleWebhookEvent(event: SlackEvent): void {
    // Skip bot messages and message changes
    if (event.bot_id || event.subtype) {
      return;
    }

    const gatewayMessage: GatewayMessage = {
      id: event.ts,
      platform: "slack",
      channelId: event.channel || "",
      userId: event.user || "",
      userName: event.user || "",
      text: event.text || "",
      timestamp: parseFloat(event.ts) * 1000,
      replyTo: event.thread_ts,
      metadata: {
        channelType: event.channel_type,
        team: event.team,
        files: event.files,
        blocks: event.blocks,
      },
    };

    this.handleMessage(gatewayMessage);
  }

  // ─── Private Methods ────────────────────────────────────────────

  private async verifyToken(): Promise<void> {
    const result = await this.callAPI("auth.test");

    if (!result.ok) {
      throw new Error("Invalid bot token");
    }
  }

  private async connectSocketMode(): Promise<void> {
    // Get WebSocket URL
    const result = await this.callAPI("apps.connections.open", {}, true);

    if (!result.ok || !result.url) {
      throw new Error("Failed to get Socket Mode URL");
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(result.url);
      this.socketConnection = ws;

      ws.onopen = () => {
        this.reconnectAttempts = 0;
        resolve();
      };

      ws.onmessage = (event) => {
        const payload = JSON.parse(event.data);
        this.handleSocketPayload(payload);
      };

      ws.onerror = (error) => {
        reject(error);
      };

      ws.onclose = () => {
        this.handleSocketClose();
      };
    });
  }

  private handleSocketPayload(payload: any): void {
    // Acknowledge envelope_id
    if (payload.envelope_id) {
      this.socketConnection?.send(
        JSON.stringify({ envelope_id: payload.envelope_id })
      );
    }

    // Handle the event
    if (payload.payload?.event) {
      this.handleWebhookEvent(payload.payload.event);
    }

    // Handle interactions
    if (payload.payload?.actions) {
      this.handleBlockAction(payload.payload);
    }

    // Handle commands
    if (payload.payload?.command) {
      this.handleSlashCommand(payload.payload);
    }
  }

  private handleSocketClose(): void {
    if (!this.connected) {
      return;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        this.connectSocketMode().catch(() => {});
      }, 5000 * this.reconnectAttempts);
    }
  }

  private async callAPI(
    method: string,
    params: Record<string, any> = {},
    useAppToken = false
  ): Promise<any> {
    const token = useAppToken ? this.appToken : this.botToken;

    const response = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status}`);
    }

    const data = (await response.json()) as any;

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    return data;
  }
}

/**
 * Create Slack gateway
 */
export function createSlackGateway(config: {
  botToken: string;
  signingSecret: string;
  appToken?: string;
  webhookUrl?: string;
  socketMode?: boolean;
  enabled?: boolean;
  allowlist?: string[];
  blocklist?: string[];
}): SlackGateway {
  return new SlackGateway({
    platform: "slack",
    enabled: config.enabled ?? true,
    socketMode: config.socketMode,
    credentials: {
      botToken: config.botToken,
      signingSecret: config.signingSecret,
      appToken: config.appToken,
      webhookUrl: config.webhookUrl,
    },
    allowlist: config.allowlist,
    blocklist: config.blocklist,
  });
}

// ─── Block Kit Helpers ──────────────────────────────────────────

/**
 * Create a text section block
 */
export function createTextBlock(text: string, emoji = true): SlackBlock {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text,
    },
  };
}

/**
 * Create a button element
 */
export function createButton(
  text: string,
  actionId: string,
  options?: { value?: string; url?: string; style?: "primary" | "danger" }
): any {
  const button: any = {
    type: "button",
    text: {
      type: "plain_text",
      text,
      emoji: true,
    },
    action_id: actionId,
  };

  if (options?.value) {
    button.value = options.value;
  }

  if (options?.url) {
    button.url = options.url;
  }

  if (options?.style) {
    button.style = options.style;
  }

  return button;
}

/**
 * Create an actions block with buttons
 */
export function createActionsBlock(elements: any[]): SlackBlock {
  return {
    type: "actions",
    elements,
  };
}

/**
 * Create a divider block
 */
export function createDividerBlock(): SlackBlock {
  return {
    type: "divider",
  };
}

/**
 * Create a context block
 */
export function createContextBlock(elements: any[]): SlackBlock {
  return {
    type: "context",
    elements,
  };
}

/**
 * Create an image block
 */
export function createImageBlock(
  imageUrl: string,
  altText: string,
  title?: string
): SlackBlock {
  const block: SlackBlock = {
    type: "image",
    accessory: {
      type: "image",
      image_url: imageUrl,
      alt_text: altText,
    },
  };

  if (title) {
    block.title = {
      type: "plain_text",
      text: title,
    };
  }

  return block;
}

/**
 * Create an input block
 */
export function createInputBlock(
  label: string,
  actionId: string,
  options?: {
    placeholder?: string;
    multiline?: boolean;
    initialValue?: string;
  }
): SlackBlock {
  return {
    type: "input",
    block_id: `${actionId}_block`,
    label: {
      type: "plain_text",
      text: label,
    },
    element: {
      type: options?.multiline ? "plain_text_input" : "plain_text_input",
      action_id: actionId,
      placeholder: options?.placeholder
        ? { type: "plain_text", text: options.placeholder }
        : undefined,
      initial_value: options?.initialValue,
      multiline: options?.multiline,
    },
  };
}
