import { describe, it, expect, beforeEach } from "vitest";
import { ModelRouter, DefaultStrategy, CostAwareStrategy, HealthAwareStrategy } from "../src/models/router.js";
import { OpenAIProvider } from "../src/models/providers/openai.js";
import { AnthropicProvider } from "../src/models/providers/anthropic.js";
import { HealthRegistry } from "../src/models/health.js";

describe("ModelRouter", () => {
  let router: ModelRouter;

  beforeEach(() => {
    router = new ModelRouter();
  });

  it("should register providers", () => {
    const provider = new OpenAIProvider({ apiKey: "test" });
    router.register("openai", provider);

    expect(router.listProviders()).toContain("openai");
    expect(router.getProvider("openai")).toBe(provider);
  });

  it("should route to default provider", () => {
    const provider = new OpenAIProvider({ apiKey: "test" });
    router.register("openai", provider);

    expect(router.getDefault()).toBe(provider);
  });

  it("should route with fallback", () => {
    const openai = new OpenAIProvider({ apiKey: "test" });
    const anthropic = new AnthropicProvider({ apiKey: "test" });

    router.register("openai", openai);
    router.register("anthropic", anthropic);

    const fallbacks = router.routeWithFallback("chat");
    expect(fallbacks.length).toBe(2);
  });

  it("should track provider health", () => {
    const provider = new OpenAIProvider({ apiKey: "test" });
    router.register("openai", provider);

    router.recordSuccess("openai", 100);
    router.recordFailure("openai", "error", 500);

    const metrics = router.getHealthMetrics();
    expect(metrics.get("openai")?.totalRequests).toBe(2);
  });

  it("should auto-fallback with retry strategy", () => {
    const openai = new OpenAIProvider({ apiKey: "test" });
    const anthropic = new AnthropicProvider({ apiKey: "test" });

    router.register("openai", openai);
    router.register("anthropic", anthropic);

    const result = router.routeWithAutoFallback("chat", 2);

    expect(result.primary).toBeDefined();
    expect(result.fallbacks.length).toBe(1);
    expect(result.retryStrategy).toBeDefined();
  });
});

describe("DefaultStrategy", () => {
  it("should route embed tasks to providers with embed", () => {
    const strategy = new DefaultStrategy();
    const providers = new Map();

    const openai = new OpenAIProvider({ apiKey: "test" });
    providers.set("openai", openai);

    const result = strategy.route("embed", providers);
    expect(result).toBe(openai);
  });

  it("should route code tasks to providers with function calling", () => {
    const strategy = new DefaultStrategy();
    const providers = new Map();

    const openai = new OpenAIProvider({ apiKey: "test" });
    providers.set("openai", openai);

    const result = strategy.route("code", providers);
    expect(result.capabilities.functionCalling).toBe(true);
  });
});

describe("CostAwareStrategy", () => {
  it("should prefer cheaper models for simple tasks", () => {
    const strategy = new CostAwareStrategy();
    const providers = new Map();

    providers.set("gpt-4o-mini", new OpenAIProvider({ apiKey: "test", model: "gpt-4o-mini" }));
    providers.set("gpt-4o", new OpenAIProvider({ apiKey: "test", model: "gpt-4o" }));

    const result = strategy.route("chat", providers);
    expect(result.name).toBe("gpt-4o-mini");
  });
});

describe("HealthAwareStrategy", () => {
  it("should filter to healthy providers", () => {
    const registry = new HealthRegistry({ minRequests: 1, failureThreshold: 0.5 });
    const inner = new DefaultStrategy();
    const strategy = new HealthAwareStrategy(registry, inner);

    const providers = new Map();
    const openai = new OpenAIProvider({ apiKey: "test" });
    const anthropic = new AnthropicProvider({ apiKey: "test" });

    providers.set("openai", openai);
    providers.set("anthropic", anthropic);

    // Make openai unhealthy
    registry.get("openai").recordFailure("error", 100);

    const result = strategy.route("chat", providers);
    expect(result).toBe(anthropic);
  });
});
