import { describe, it, expect, beforeEach } from "vitest";
import {
  Gateway,
  GatewayConfig,
  GatewayMessage,
  GatewayRegistry,
  MessageRouter,
} from "../src/gateway/base.js";
import { FeishuGateway, FeishuConfig } from "../src/gateway/feishu.js";

// Mock Gateway for testing
class MockGateway extends Gateway {
  sentMessages: Array<{ channelId: string; text: string }> = [];

  async connect(): Promise<boolean> {
    this.connected = true;
    this.stats.connected = true;
    this.emit("connect");
    return true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.stats.connected = false;
    this.emit("disconnect");
  }

  async sendMessage(channelId: string, text: string): Promise<void> {
    this.sentMessages.push({ channelId, text });
    this.stats.messagesSent++;
  }
}

describe("Gateway", () => {
  let gateway: MockGateway;

  beforeEach(() => {
    gateway = new MockGateway({
      platform: "mock",
      enabled: true,
      credentials: {},
    });
  });

  describe("connect", () => {
    it("connects successfully", async () => {
      const result = await gateway.connect();
      expect(result).toBe(true);
      expect(gateway.isConnected()).toBe(true);
    });

    it("emits connect event", async () => {
      let connected = false;
      gateway.on("connect", () => {
        connected = true;
      });

      await gateway.connect();
      expect(connected).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("disconnects successfully", async () => {
      await gateway.connect();
      await gateway.disconnect();
      expect(gateway.isConnected()).toBe(false);
    });
  });

  describe("sendMessage", () => {
    it("sends message", async () => {
      await gateway.connect();
      await gateway.sendMessage("channel-1", "Hello");

      expect(gateway.sentMessages).toHaveLength(1);
      expect(gateway.sentMessages[0]).toEqual({
        channelId: "channel-1",
        text: "Hello",
      });
    });
  });

  describe("getStats", () => {
    it("returns stats", async () => {
      await gateway.connect();
      const stats = gateway.getStats();

      expect(stats.platform).toBe("mock");
      expect(stats.connected).toBe(true);
    });
  });

  describe("isAllowed", () => {
    it("allows all when no lists defined", () => {
      expect(gateway["isAllowed"]("user-1")).toBe(true);
    });

    it("blocks blocked users", () => {
      gateway = new MockGateway({
        platform: "mock",
        enabled: true,
        credentials: {},
        blocklist: ["user-1"],
      });

      expect(gateway["isAllowed"]("user-1")).toBe(false);
      expect(gateway["isAllowed"]("user-2")).toBe(true);
    });

    it("respects allowlist", () => {
      gateway = new MockGateway({
        platform: "mock",
        enabled: true,
        credentials: {},
        allowlist: ["user-1"],
      });

      expect(gateway["isAllowed"]("user-1")).toBe(true);
      expect(gateway["isAllowed"]("user-2")).toBe(false);
    });
  });
});

describe("GatewayRegistry", () => {
  let registry: GatewayRegistry;

  beforeEach(() => {
    registry = new GatewayRegistry();
  });

  describe("register", () => {
    it("registers gateway", () => {
      const gateway = new MockGateway({
        platform: "mock",
        enabled: true,
        credentials: {},
      });

      registry.register(gateway);
      expect(registry.get("mock")).toBe(gateway);
    });
  });

  describe("getAll", () => {
    it("returns all gateways", () => {
      const g1 = new MockGateway({ platform: "g1", enabled: true, credentials: {} });
      const g2 = new MockGateway({ platform: "g2", enabled: true, credentials: {} });

      registry.register(g1);
      registry.register(g2);

      expect(registry.getAll()).toHaveLength(2);
    });
  });

  describe("connectAll", () => {
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
});

describe("MessageRouter", () => {
  let registry: GatewayRegistry;
  let router: MessageRouter;

  beforeEach(() => {
    registry = new GatewayRegistry();
    router = new MessageRouter(registry);
  });

  describe("routeIncoming", () => {
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
  });

  describe("sendReply", () => {
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
});

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
