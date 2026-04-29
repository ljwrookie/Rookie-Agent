/**
 * Gateway Tests - P6: Multi-platform gateway tests
 *
 * Tests for:
 * - Gateway Manager
 * - Session Bridge
 * - DingTalk Gateway
 * - WeCom Gateway
 * - Telegram Gateway
 * - Discord Gateway
 * - Slack Gateway
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  GatewayManager,
  SessionBridge,
  Gateway,
  type GatewayConfig,
  type GatewayMessage,
  GatewayRegistry,
  MessageRouter,
  FeishuGateway,
  type FeishuConfig,
  DingTalkGateway,
  WeComGateway,
  TelegramGateway,
  DiscordGateway,
  SlackGateway,
  createDingTalkGateway,
  createWeComAppGateway,
  createWeComWebhookGateway,
  createTelegramGateway,
  createDiscordGateway,
  createSlackGateway,
  createTextBlock,
  createButton,
  createDividerBlock,
} from "../src/gateway/index.js";

// ─── Mock Gateways ──────────────────────────────────────────────

class MockGateway extends Gateway {
  sentMessages: Array<{ channelId: string; text: string }> = [];

  constructor(config: GatewayConfig) {
    super(config);
  }

  async connect(): Promise<boolean> {
    this.connected = true;
    this.stats.connected = true;
    this.emit("connected");
    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.stats.connected = false;
    this.emit("disconnected");
  }

  async sendMessage(
    channelId: string,
    text: string,
    _options?: { replyTo?: string; threadId?: string }
  ): Promise<void> {
    this.sentMessages.push({ channelId, text });
    this.stats.messagesSent++;
  }
}

// ─── Base Gateway Tests ─────────────────────────────────────────

describe("Gateway Base", () => {
  let gateway: MockGateway;

  beforeEach(() => {
    gateway = new MockGateway({
      platform: "mock",
      enabled: true,
      credentials: {},
    });
  });

  it("connects successfully", async () => {
    const result = await gateway.connect();
    expect(result).toBe(true);
    expect(gateway.isConnected()).toBe(true);
  });

  it("emits connect event", async () => {
    let connected = false;
    gateway.on("connected", () => {
      connected = true;
    });

    await gateway.connect();
    expect(connected).toBe(true);
  });

  it("disconnects successfully", async () => {
    await gateway.connect();
    await gateway.disconnect();
    expect(gateway.isConnected()).toBe(false);
  });

  it("sends message", async () => {
    await gateway.connect();
    await gateway.sendMessage("channel-1", "Hello");

    expect(gateway.sentMessages).toHaveLength(1);
    expect(gateway.sentMessages[0]).toEqual({
      channelId: "channel-1",
      text: "Hello",
    });
  });

  it("returns stats", async () => {
    await gateway.connect();
    const stats = gateway.getStats();

    expect(stats.platform).toBe("mock");
    expect(stats.connected).toBe(true);
  });

  it("allows all when no lists defined", () => {
    expect((gateway as any)["isAllowed"]("user-1")).toBe(true);
  });

  it("blocks blocked users", () => {
    gateway = new MockGateway({
      platform: "mock",
      enabled: true,
      credentials: {},
      blocklist: ["user-1"],
    });

    expect((gateway as any)["isAllowed"]("user-1")).toBe(false);
    expect((gateway as any)["isAllowed"]("user-2")).toBe(true);
  });

  it("respects allowlist", () => {
    gateway = new MockGateway({
      platform: "mock",
      enabled: true,
      credentials: {},
      allowlist: ["user-1"],
    });

    expect((gateway as any)["isAllowed"]("user-1")).toBe(true);
    expect((gateway as any)["isAllowed"]("user-2")).toBe(false);
  });
});

// ─── Gateway Registry Tests ─────────────────────────────────────

describe("GatewayRegistry", () => {
  let registry: GatewayRegistry;

  beforeEach(() => {
    registry = new GatewayRegistry();
  });

  it("registers gateway", () => {
    const gateway = new MockGateway({
      platform: "mock",
      enabled: true,
      credentials: {},
    });

    registry.register(gateway);
    expect(registry.get("mock")).toBe(gateway);
  });

  it("returns all gateways", () => {
    const g1 = new MockGateway({ platform: "g1", enabled: true, credentials: {} });
    const g2 = new MockGateway({ platform: "g2", enabled: true, credentials: {} });

    registry.register(g1);
    registry.register(g2);

    expect(registry.getAll()).toHaveLength(2);
  });

  it("connects enabled gateways", async () => {
    const enabled = new MockGateway({ platform: "enabled", enabled: true, credentials: {} });
    const disabled = new MockGateway({ platform: "disabled", enabled: false, credentials: {} });

    registry.register(enabled);
    registry.register(disabled);

    const results = await registry.connectAll();

    expect(results.get("enabled")).toBe(true);
    expect(results.get("disabled")).toBe(false);
  });
});

// ─── Message Router Tests ───────────────────────────────────────

describe("MessageRouter", () => {
  let registry: GatewayRegistry;
  let router: MessageRouter;

  beforeEach(() => {
    registry = new GatewayRegistry();
    router = new MessageRouter(registry);
  });

  it("emits agent:message event", () => {
    let received: any = null;
    router.on("agent:message", (data) => {
      received = data;
    });

    const message: GatewayMessage = {
      id: "msg-1",
      platform: "mock",
      channelId: "chan-1",
      userId: "user-1",
      userName: "Test User",
      text: "Hello",
      timestamp: Date.now(),
    };

    router.routeIncoming(message);

    expect(received).toBeDefined();
    expect(received.message.content).toBe("Hello");
    expect(received.platform).toBe("mock");
    expect(typeof received.reply).toBe("function");
  });

  it("sends reply via gateway", async () => {
    const gateway = new MockGateway({ platform: "mock", enabled: true, credentials: {} });
    await gateway.connect();
    registry.register(gateway);

    await router.sendReply("mock", "chan-1", "Reply text");

    expect(gateway.sentMessages).toHaveLength(1);
    expect(gateway.sentMessages[0].text).toBe("Reply text");
  });

  it("throws if gateway not available", async () => {
    await expect(router.sendReply("nonexistent", "chan-1", "text")).rejects.toThrow(
      "Gateway nonexistent not available"
    );
  });
});

// ─── Gateway Manager Tests ──────────────────────────────────────

describe("GatewayManager", () => {
  let manager: GatewayManager;

  beforeEach(() => {
    manager = new GatewayManager();
  });

  it("should register gateways", () => {
    const gateway = new MockGateway({
      platform: "test",
      enabled: true,
      credentials: {},
    });

    manager.register(gateway);

    expect(manager.get("test")).toBe(gateway);
    expect(manager.getAll()).toHaveLength(1);
  });

  it("should unregister gateways", () => {
    const gateway = new MockGateway({
      platform: "test",
      enabled: true,
      credentials: {},
    });

    manager.register(gateway);
    manager.unregister("test");

    expect(manager.get("test")).toBeUndefined();
  });

  it("should connect all enabled gateways", async () => {
    const gateway1 = new MockGateway({
      platform: "test1",
      enabled: true,
      credentials: {},
    });
    const gateway2 = new MockGateway({
      platform: "test2",
      enabled: false,
      credentials: {},
    });

    manager.register(gateway1);
    manager.register(gateway2);

    const results = await manager.connectAll();

    expect(results.get("test1")).toBe(true);
    expect(results.get("test2")).toBe(false);
  });

  it("should disconnect all gateways", async () => {
    const gateway = new MockGateway({
      platform: "test",
      enabled: true,
      credentials: {},
    });

    manager.register(gateway);
    await manager.connectAll();
    await manager.disconnectAll();

    expect(gateway.isConnected()).toBe(false);
  });

  it("should bind and retrieve sessions", () => {
    const session = manager.bindSession(
      "session-1",
      "test-platform",
      "channel-1",
      "user-1",
      { test: true }
    );

    expect(session.id).toBe("session-1");
    expect(session.platform).toBe("test-platform");

    const retrieved = manager.getSession("test-platform", "channel-1", "user-1");
    expect(retrieved).toEqual(session);
  });

  it("should unbind sessions", () => {
    manager.bindSession("session-1", "test-platform", "channel-1", "user-1");

    const result = manager.unbindSession("test-platform", "channel-1", "user-1");

    expect(result).toBe(true);
    expect(
      manager.getSession("test-platform", "channel-1", "user-1")
    ).toBeUndefined();
  });

  it("should get session by ID", () => {
    manager.bindSession("session-1", "test-platform", "channel-1", "user-1");

    const session = manager.getSessionById("session-1");

    expect(session).toBeDefined();
    expect(session?.id).toBe("session-1");
  });

  it("should get active sessions", () => {
    manager.bindSession("session-1", "platform-1", "channel-1", "user-1");
    manager.bindSession("session-2", "platform-2", "channel-2", "user-2");

    const sessions = manager.getActiveSessions();

    expect(sessions).toHaveLength(2);
  });

  it("should get sessions by platform", () => {
    manager.bindSession("session-1", "platform-1", "channel-1", "user-1");
    manager.bindSession("session-2", "platform-1", "channel-2", "user-2");
    manager.bindSession("session-3", "platform-2", "channel-3", "user-3");

    const sessions = manager.getSessionsByPlatform("platform-1");

    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.platform === "platform-1")).toBe(true);
  });

  it("should emit events on gateway registration", () => {
    const handler = vi.fn();
    manager.on("gateway:registered", handler);

    const gateway = new MockGateway({
      platform: "test",
      enabled: true,
      credentials: {},
    });

    manager.register(gateway);

    expect(handler).toHaveBeenCalledWith({ platform: "test" });
  });

  it("should emit events on session binding", () => {
    const handler = vi.fn();
    manager.on("session:bound", handler);

    manager.bindSession("session-1", "test-platform", "channel-1", "user-1");

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0].id).toBe("session-1");
  });

  it("should get manager stats", () => {
    const gateway = new MockGateway({
      platform: "test",
      enabled: true,
      credentials: {},
    });

    manager.register(gateway);
    manager.bindSession("session-1", "test-platform", "channel-1", "user-1");

    const stats = manager.getManagerStats();

    expect(stats.gateways).toBe(1);
    expect(stats.sessions).toBe(1);
  });
});

// ─── Session Bridge Tests ───────────────────────────────────────

describe("SessionBridge", () => {
  let manager: GatewayManager;
  let bridge: SessionBridge;

  beforeEach(() => {
    manager = new GatewayManager();
    bridge = new SessionBridge(manager);
  });

  it("should create bridged sessions", () => {
    const session = bridge.createSession(
      "session-1",
      "test-platform",
      "channel-1",
      "user-1",
      { test: true }
    );

    expect(session.id).toBe("session-1");
    expect(session.linkedSessions).toEqual([]);
    expect(session.context.messages).toEqual([]);
  });

  it("should link sessions across platforms", () => {
    bridge.createSession("session-1", "platform-1", "channel-1", "user-1");

    const result = bridge.linkSessions(
      "session-1",
      "platform-2",
      "channel-2",
      "user-2"
    );

    expect(result).toBe(true);

    const session = bridge.getBridgedSession("session-1");
    expect(session?.linkedSessions).toHaveLength(1);
    expect(session?.linkedSessions[0].platform).toBe("platform-2");
  });

  it("should unlink sessions", () => {
    bridge.createSession("session-1", "platform-1", "channel-1", "user-1");
    bridge.linkSessions("session-1", "platform-2", "channel-2", "user-2");

    const result = bridge.unlinkSession("session-1", "platform-2", "channel-2", "user-2");

    expect(result).toBe(true);

    const session = bridge.getBridgedSession("session-1");
    expect(session?.linkedSessions).toHaveLength(0);
  });

  it("should add and retrieve messages", () => {
    bridge.createSession("session-1", "platform-1", "channel-1", "user-1");

    const message = bridge.addMessage("session-1", {
      platform: "platform-1",
      role: "user",
      content: "Hello",
    });

    expect(message.content).toBe("Hello");
    expect(message.id).toBeDefined();
    expect(message.timestamp).toBeDefined();

    const messages = bridge.getMessages("session-1");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello");
  });

  it("should get context messages with strategy", () => {
    bridge.createSession("session-1", "platform-1", "channel-1", "user-1");

    // Add 15 messages
    for (let i = 0; i < 15; i++) {
      bridge.addMessage("session-1", {
        platform: "platform-1",
        role: "user",
        content: `Message ${i}`,
      });
    }

    const contextMessages = bridge.getContextMessages("session-1");

    // Default recent strategy keeps 10 messages
    expect(contextMessages.length).toBeLessThanOrEqual(10);
  });

  it("should destroy sessions", () => {
    bridge.createSession("session-1", "platform-1", "channel-1", "user-1");

    const result = bridge.destroySession("session-1");

    expect(result).toBe(true);
    expect(bridge.getBridgedSession("session-1")).toBeUndefined();
  });

  it("should get bridge stats", () => {
    bridge.createSession("session-1", "platform-1", "channel-1", "user-1");
    bridge.createSession("session-2", "platform-2", "channel-2", "user-2");
    bridge.linkSessions("session-1", "platform-3", "channel-3", "user-3");

    bridge.addMessage("session-1", {
      platform: "platform-1",
      role: "user",
      content: "Hello",
    });

    const stats = bridge.getStats();

    expect(stats.sessions).toBe(2);
    expect(stats.linkedSessions).toBe(1);
    expect(stats.totalMessages).toBe(1);
  });
});

// ─── Platform Gateway Tests ─────────────────────────────────────

describe("DingTalkGateway", () => {
  it("should create DingTalk gateway", () => {
    const gateway = new DingTalkGateway({
      platform: "dingtalk",
      enabled: true,
      credentials: {
        appKey: "test-key",
        appSecret: "test-secret",
      },
    });

    expect(gateway).toBeDefined();
    expect(gateway["config"].platform).toBe("dingtalk");
  });

  it("should provide factory function", () => {
    const gateway = createDingTalkGateway({
      appKey: "test-key",
      appSecret: "test-secret",
    });

    expect(gateway).toBeDefined();
  });
});

describe("WeComGateway", () => {
  it("should create WeCom app gateway", () => {
    const gateway = createWeComAppGateway({
      corpId: "test-corp",
      agentId: "test-agent",
      secret: "test-secret",
    });

    expect(gateway).toBeDefined();
  });

  it("should create WeCom webhook gateway", () => {
    const gateway = createWeComWebhookGateway({
      webhookKey: "test-key",
    });

    expect(gateway).toBeDefined();
    expect(gateway["config"].platform).toBe("wecom-webhook");
  });
});

describe("TelegramGateway", () => {
  it("should create Telegram gateway", () => {
    const gateway = createTelegramGateway({
      botToken: "test-token",
    });

    expect(gateway).toBeDefined();
  });

  it("should split long messages", () => {
    const gateway = new TelegramGateway({
      platform: "telegram",
      enabled: true,
      credentials: { botToken: "test" },
    });

    // Access private method for testing
    const splitMessage = (gateway as any)["splitMessage"].bind(gateway);

    const longText = "a".repeat(5000);
    const chunks = splitMessage(longText, 4096);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c: string) => c.length <= 4096)).toBe(true);
  });
});

describe("DiscordGateway", () => {
  it("should create Discord gateway", () => {
    const gateway = createDiscordGateway({
      botToken: "test-token",
      applicationId: "test-app-id",
    });

    expect(gateway).toBeDefined();
  });
});

describe("SlackGateway", () => {
  it("should create Slack gateway", () => {
    const gateway = createSlackGateway({
      botToken: "test-token",
      signingSecret: "test-secret",
    });

    expect(gateway).toBeDefined();
  });

  it("should provide Block Kit helpers", () => {
    const textBlock = createTextBlock("Hello");
    expect(textBlock.type).toBe("section");

    const button = createButton("Click me", "action-1");
    expect(button.type).toBe("button");

    const divider = createDividerBlock();
    expect(divider.type).toBe("divider");
  });
});

// ─── Feishu Gateway Tests ───────────────────────────────────────

describe("FeishuGateway", () => {
  describe("constructor", () => {
    it("creates gateway with config", () => {
      const config: FeishuConfig = {
        platform: "feishu",
        enabled: true,
        credentials: {
          appId: "test-app-id",
          appSecret: "test-app-secret",
        },
      };

      const gateway = new FeishuGateway(config);
      expect(gateway.isConnected()).toBe(false);
    });
  });

  describe("createVerificationResponse", () => {
    it("returns challenge response", () => {
      const config: FeishuConfig = {
        platform: "feishu",
        enabled: true,
        credentials: {
          appId: "test",
          appSecret: "secret",
        },
      };

      const gateway = new FeishuGateway(config);
      const response = gateway.createVerificationResponse("test-challenge");

      expect(response.challenge).toBe("test-challenge");
    });
  });

  describe("handleWebhook", () => {
    it("emits message for valid event", () => {
      const config: FeishuConfig = {
        platform: "feishu",
        enabled: true,
        credentials: {
          appId: "test",
          appSecret: "secret",
        },
        botName: "RookieBot",
      };

      const gateway = new FeishuGateway(config);
      let receivedMessage: GatewayMessage | null = null;

      gateway.on("message", (msg) => {
        receivedMessage = msg;
      });

      const event = {
        header: {
          event_id: "evt-1",
          event_type: "im.message.receive_v1",
          create_time: "1234567890",
          token: "",
          app_id: "test",
          tenant_key: "tenant-1",
        },
        event: {
          sender: {
            sender_id: {
              open_id: "user-1",
              union_id: "union-1",
              user_id: "user-1",
            },
            sender_type: "user",
            tenant_key: "tenant-1",
          },
          message: {
            message_id: "msg-1",
            create_time: "1234567890",
            chat_id: "chat-1",
            chat_type: "p2p",
            message_type: "text",
            content: JSON.stringify({ text: "Hello @RookieBot" }),
            mentions: [
              {
                key: "@RookieBot",
                id: { open_id: "bot-1", union_id: "bot-1", user_id: "bot-1" },
                name: "RookieBot",
                tenant_key: "tenant-1",
              },
            ],
          },
        },
      };

      gateway.handleWebhook(event);

      expect(receivedMessage).toBeDefined();
      expect(receivedMessage!.text).toBe("Hello"); // @mention removed
      expect(receivedMessage!.userId).toBe("user-1");
    });
  });
});

// ─── Integration Tests ──────────────────────────────────────────

describe("Gateway Integration", () => {
  it("should route messages between gateways", async () => {
    const manager = new GatewayManager();

    const gateway1 = new MockGateway({
      platform: "platform-1",
      enabled: true,
      credentials: {},
    });
    const gateway2 = new MockGateway({
      platform: "platform-2",
      enabled: true,
      credentials: {},
    });

    manager.register(gateway1);
    manager.register(gateway2);

    await manager.connectAll();

    // Bind sessions
    manager.bindSession("session-1", "platform-1", "channel-1", "user-1");

    // Simulate incoming message
    const message: GatewayMessage = {
      id: "msg-1",
      platform: "platform-1",
      channelId: "channel-1",
      userId: "user-1",
      userName: "Test User",
      text: "Hello",
      timestamp: Date.now(),
    };

    gateway1.emit("message", message);

    // Verify session was touched
    const session = manager.getSession("platform-1", "channel-1", "user-1");
    expect(session).toBeDefined();
  });

  it("should broadcast messages to all platforms", async () => {
    const manager = new GatewayManager();

    const gateway1 = new MockGateway({
      platform: "platform-1",
      enabled: true,
      credentials: {},
    });
    const gateway2 = new MockGateway({
      platform: "platform-2",
      enabled: true,
      credentials: {},
    });

    manager.register(gateway1);
    manager.register(gateway2);

    await manager.connectAll();

    // Bind sessions to enable broadcast
    manager.bindSession("session-1", "platform-1", "channel-1", "user-1");
    manager.bindSession("session-2", "platform-2", "channel-2", "user-2");

    const results = await manager.broadcast("Hello everyone!");

    expect(results.get("platform-1")).toBe(true);
    expect(results.get("platform-2")).toBe(true);
  });
});
