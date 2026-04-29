/**
 * Gateway module - Multi-platform message gateway
 *
 * Provides unified interfaces for:
 * - Feishu (飞书)
 * - DingTalk (钉钉)
 * - WeCom (企业微信)
 * - Telegram
 * - Discord
 * - Slack
 */

// Base classes and types
export {
  Gateway,
  GatewayRegistry,
  MessageRouter,
  type GatewayConfig,
  type GatewayMessage,
  type GatewaySendOptions,
  type GatewayStats,
  type RouterConfig,
} from "./base.js";

// Gateway Manager and Session Bridge
export {
  GatewayManager,
  getGlobalGatewayManager,
  setGlobalGatewayManager,
  type GatewayManagerConfig,
  type GatewayHealth,
  type GatewaySession,
} from "./manager.js";
export * from "./session-bridge.js";

// Platform-specific gateways
export {
  DingTalkGateway,
  createDingTalkGateway,
  type DingTalkConfig,
  type DingTalkMessage,
  type DingTalkAIStreamCard,
} from "./dingtalk.js";

export {
  WeComGateway,
  createWeComAppGateway,
  createWeComWebhookGateway,
  type WeComConfig,
  type WeComMessage,
  type WeComCallbackMessage,
} from "./wecom.js";

export {
  TelegramGateway,
  createTelegramGateway,
  type TelegramConfig,
  type TelegramMessage,
  type TelegramUpdate,
} from "./telegram.js";

export {
  DiscordGateway,
  createDiscordGateway,
  type DiscordConfig,
  type DiscordMessage,
  type DiscordInteraction,
  type DiscordEmbed,
} from "./discord.js";

export {
  SlackGateway,
  createSlackGateway,
  createTextBlock,
  createButton,
  createActionsBlock,
  createDividerBlock,
  createContextBlock,
  createImageBlock,
  createInputBlock,
  type SlackConfig,
  type SlackEvent,
  type SlackBlock,
  type SlackAttachment,
  type SlackCommandRequest,
} from "./slack.js";

// Re-export Feishu
export * from "./feishu.js";
