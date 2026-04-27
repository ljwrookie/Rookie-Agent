# Multi-Platform Gateway

Rookie Agent can operate across multiple messaging platforms.

## Supported Platforms

| Platform | Status |
|----------|--------|
| Feishu/Lark | ✅ Implemented |
| WeChat | 🚧 Planned |
| Email | 🚧 Planned |

## Feishu Setup

```typescript
import { FeishuGateway } from "@rookie/agent-sdk";

const gateway = new FeishuGateway({
  platform: "feishu",
  enabled: true,
  credentials: {
    appId: "your-app-id",
    appSecret: "your-app-secret",
  },
  botName: "RookieBot",
});

await gateway.connect();
await gateway.sendMessage("chat-id", "Hello from Rookie!");
```

## Message Router

```typescript
import { GatewayRegistry, MessageRouter } from "@rookie/agent-sdk";

const registry = new GatewayRegistry();
registry.register(gateway);

const router = new MessageRouter(registry);
router.on("agent:message", async ({ message, reply }) => {
  const response = await agent.process(message.text);
  await reply(response);
});
```

## Shared Memory

All platforms share the same memory store and skill registry.
