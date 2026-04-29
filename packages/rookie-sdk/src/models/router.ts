import { ModelProvider } from "./types.js";
import { HealthRegistry } from "./health.js";

export type TaskType = "code" | "chat" | "embed" | "fast" | "reasoning" | "review" | "architect";

export interface RoutingStrategy {
  route(task: TaskType, providers: Map<string, ModelProvider>): ModelProvider;
}

/**
 * DefaultStrategy: routes based on ModelCapabilities.
 */
export class DefaultStrategy implements RoutingStrategy {
  route(task: TaskType, providers: Map<string, ModelProvider>): ModelProvider {
    switch (task) {
      case "embed": {
        for (const [, provider] of providers) {
          if (provider.embed) return provider;
        }
        break;
      }
      case "fast": {
        // Prefer small context models for fast responses
        for (const [, provider] of providers) {
          if (provider.capabilities.contextWindow < 32000) return provider;
        }
        break;
      }
      case "reasoning":
      case "architect": {
        // Pick the provider with the largest context window
        let best: ModelProvider | undefined;
        for (const [, provider] of providers) {
          if (!best || provider.capabilities.contextWindow > best.capabilities.contextWindow) {
            best = provider;
          }
        }
        if (best) return best;
        break;
      }
      case "code":
      case "review": {
        // Prefer providers with function calling for code tasks
        for (const [, provider] of providers) {
          if (provider.capabilities.functionCalling) return provider;
        }
        break;
      }
      case "chat": {
        // Any provider works for chat
        break;
      }
    }

    // Fallback to first available provider
    const first = providers.values().next().value;
    if (!first) {
      throw new Error("No model provider registered");
    }
    return first;
  }
}

/**
 * CostAwareStrategy: prefers cheaper models when capable, falls back to expensive ones.
 */
export class CostAwareStrategy implements RoutingStrategy {
  private costTiers: Map<string, number>;

  constructor(costTiers?: Map<string, number>) {
    this.costTiers = costTiers || new Map([
      ["gpt-4o-mini", 1],
      ["claude-3-haiku", 1],
      ["gpt-4o", 2],
      ["claude-sonnet-4", 3],
      ["claude-opus", 4],
      ["o1", 5],
    ]);
  }

  route(task: TaskType, providers: Map<string, ModelProvider>): ModelProvider {
    // For simple tasks, prefer cheap models
    const isSimple = task === "chat" || task === "fast";

    const sorted = Array.from(providers.entries()).sort(([a], [b]) => {
      const costA = this.costTiers.get(a) || 3;
      const costB = this.costTiers.get(b) || 3;
      return isSimple ? costA - costB : costB - costA;
    });

    // For complex tasks, filter to capable models
    if (task === "code" || task === "review") {
      const capable = sorted.filter(([, p]) => p.capabilities.functionCalling);
      if (capable.length > 0) return capable[0][1];
    }

    if (task === "embed") {
      const capable = sorted.filter(([, p]) => p.embed);
      if (capable.length > 0) return capable[0][1];
    }

    if (sorted.length === 0) {
      throw new Error("No model provider registered");
    }

    return sorted[0][1];
  }
}

/**
 * FallbackStrategy: tries providers in order, falling back on failure.
 */
export class FallbackStrategy implements RoutingStrategy {
  private order: string[];
  private inner: RoutingStrategy;

  constructor(preferredOrder: string[], fallback?: RoutingStrategy) {
    this.order = preferredOrder;
    this.inner = fallback || new DefaultStrategy();
  }

  route(task: TaskType, providers: Map<string, ModelProvider>): ModelProvider {
    // Try preferred order first
    for (const name of this.order) {
      const provider = providers.get(name);
      if (provider) return provider;
    }

    // Fall back to inner strategy
    return this.inner.route(task, providers);
  }
}

/**
 * Health-aware routing strategy
 */
export class HealthAwareStrategy implements RoutingStrategy {
  private healthRegistry: HealthRegistry;
  private inner: RoutingStrategy;

  constructor(healthRegistry: HealthRegistry, inner?: RoutingStrategy) {
    this.healthRegistry = healthRegistry;
    this.inner = inner || new DefaultStrategy();
  }

  route(task: TaskType, providers: Map<string, ModelProvider>): ModelProvider {
    // Filter to healthy providers only
    const healthyProviders = new Map<string, ModelProvider>();
    for (const [name, provider] of providers) {
      const health = this.healthRegistry.get(name);
      if (health.isHealthy()) {
        healthyProviders.set(name, provider);
      }
    }

    // If no healthy providers, try all (circuit breakers may have recovered)
    const candidates = healthyProviders.size > 0 ? healthyProviders : providers;

    return this.inner.route(task, candidates);
  }
}

/**
 * ModelRouter: the main entry point for model selection.
 *
 * Features:
 * - Multiple registered providers (OpenAI, Anthropic, OpenRouter, etc.)
 * - Pluggable routing strategies
 * - Default provider selection
 * - Provider health tracking with circuit breaker
 * - Automatic fallback with retry
 */
export class ModelRouter {
  private providers = new Map<string, ModelProvider>();
  private defaultProvider?: string;
  private strategy: RoutingStrategy;
  private healthRegistry: HealthRegistry;

  constructor(strategy?: RoutingStrategy, healthRegistry?: HealthRegistry) {
    this.healthRegistry = healthRegistry || new HealthRegistry();
    this.strategy = new HealthAwareStrategy(this.healthRegistry, strategy || new DefaultStrategy());
  }

  register(name: string, provider: ModelProvider): void {
    this.providers.set(name, provider);
    if (!this.defaultProvider) {
      this.defaultProvider = name;
    }
  }

  unregister(name: string): boolean {
    const removed = this.providers.delete(name);
    if (this.defaultProvider === name) {
      this.defaultProvider = this.providers.keys().next().value;
    }
    this.healthRegistry.reset(name);
    return removed;
  }

  route(task: TaskType): ModelProvider {
    return this.strategy.route(task, this.providers);
  }

  getDefault(): ModelProvider {
    if (!this.defaultProvider) {
      throw new Error("No model provider registered");
    }
    const provider = this.providers.get(this.defaultProvider);
    if (!provider) {
      throw new Error(`Provider not found: ${this.defaultProvider}`);
    }
    return provider;
  }

  getProvider(name: string): ModelProvider | undefined {
    return this.providers.get(name);
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  setDefault(name: string): void {
    if (!this.providers.has(name)) {
      throw new Error(`Provider not found: ${name}`);
    }
    this.defaultProvider = name;
  }

  setStrategy(strategy: RoutingStrategy): void {
    this.strategy = new HealthAwareStrategy(this.healthRegistry, strategy);
  }

  /**
   * Get health registry for tracking provider health
   */
  getHealthRegistry(): HealthRegistry {
    return this.healthRegistry;
  }

  /**
   * Get health metrics for all providers
   */
  getHealthMetrics(): Map<string, import("./health.js").HealthMetrics> {
    return this.healthRegistry.getAllMetrics();
  }

  /**
   * Try to route, falling back to alternative providers on failure.
   * Useful for handling rate limits or API outages.
   */
  routeWithFallback(task: TaskType): ModelProvider[] {
    const primary = this.strategy.route(task, this.providers);
    const alternates = Array.from(this.providers.values())
      .filter((p) => p !== primary);
    return [primary, ...alternates];
  }

  /**
   * Route with automatic retry and intelligent fallback.
   * Returns providers in order of preference for retry.
   */
  routeWithAutoFallback(task: TaskType, maxRetries = 3): {
    primary: ModelProvider;
    fallbacks: ModelProvider[];
    retryStrategy: "exponential-backoff" | "circuit-breaker";
  } {
    const allProviders = this.routeWithFallback(task);
    const [primary, ...fallbacks] = allProviders;

    // Determine retry strategy based on health
    const primaryHealth = this.healthRegistry.get(this.getProviderName(primary));
    const metrics = primaryHealth.getMetrics();

    const retryStrategy = metrics.circuitState === "open"
      ? "circuit-breaker"
      : "exponential-backoff";

    return {
      primary,
      fallbacks: fallbacks.slice(0, maxRetries - 1),
      retryStrategy,
    };
  }

  /**
   * Record a successful request for a provider
   */
  recordSuccess(providerName: string, latency: number): void {
    this.healthRegistry.get(providerName).recordSuccess(latency);
  }

  /**
   * Record a failed request for a provider
   */
  recordFailure(providerName: string, error: string, latency: number): void {
    this.healthRegistry.get(providerName).recordFailure(error, latency);
  }

  /**
   * Get provider name from instance
   */
  private getProviderName(provider: ModelProvider): string {
    for (const [name, p] of this.providers) {
      if (p === provider) return name;
    }
    return provider.name;
  }
}
