import { describe, it, expect, beforeEach } from "vitest";
import { ProviderHealth, HealthRegistry } from "../src/models/health.js";

describe("ProviderHealth", () => {
  let health: ProviderHealth;

  beforeEach(() => {
    health = new ProviderHealth({
      windowSize: 60000, // 1 minute
      failureThreshold: 0.5,
      latencyThreshold: 1000,
      circuitOpenDuration: 5000, // 5 seconds
      minRequests: 5,
    });
  });

  it("should track successful requests", () => {
    health.recordSuccess(100);
    health.recordSuccess(200);

    const metrics = health.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.successfulRequests).toBe(2);
    expect(metrics.successRate).toBe(1);
  });

  it("should track failed requests", () => {
    health.recordSuccess(100);
    health.recordFailure("timeout", 500);

    const metrics = health.getMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.failedRequests).toBe(1);
    expect(metrics.successRate).toBe(0.5);
    expect(metrics.lastError).toBe("timeout");
  });

  it("should calculate latency percentiles", () => {
    for (let i = 1; i <= 10; i++) {
      health.recordSuccess(i * 10);
    }

    const metrics = health.getMetrics();
    expect(metrics.p50Latency).toBe(50);
    expect(metrics.p99Latency).toBe(100);
  });

  it("should open circuit on high failure rate", () => {
    // Record 5 failures (100% failure rate, above 50% threshold)
    for (let i = 0; i < 5; i++) {
      health.recordFailure("error", 100);
    }

    expect(health.isHealthy()).toBe(false);
    expect(health.getCircuitState()).toBe("open");
  });

  it("should keep circuit closed on low failure rate", () => {
    // Record 4 successes and 1 failure (80% success rate)
    for (let i = 0; i < 4; i++) {
      health.recordSuccess(100);
    }
    health.recordFailure("error", 100);

    expect(health.isHealthy()).toBe(true);
    expect(health.getCircuitState()).toBe("closed");
  });
});

describe("HealthRegistry", () => {
  it("should track health for multiple providers", () => {
    const registry = new HealthRegistry();

    const openai = registry.get("openai");
    const anthropic = registry.get("anthropic");

    openai.recordSuccess(100);
    anthropic.recordFailure("error", 500);

    const allMetrics = registry.getAllMetrics();
    expect(allMetrics.get("openai")?.successfulRequests).toBe(1);
    expect(allMetrics.get("anthropic")?.failedRequests).toBe(1);
  });

  it("should return healthy providers", () => {
    const registry = new HealthRegistry({
      minRequests: 1,
      failureThreshold: 0.5,
    });

    registry.get("healthy").recordSuccess(100);
    registry.get("unhealthy").recordFailure("error", 100);

    const healthy = registry.getHealthyProviders();
    expect(healthy).toContain("healthy");
    expect(healthy).not.toContain("unhealthy");
  });
});
