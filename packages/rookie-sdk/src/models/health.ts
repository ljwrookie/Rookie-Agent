/**
 * Model Provider Health Tracking
 *
 * Tracks:
 * - Success rate
 * - Latency (P50, P99)
 * - Error types
 * - Circuit breaker state
 */

export interface HealthMetrics {
  /** Total requests made */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Success rate (0-1) */
  successRate: number;
  /** Average latency in ms */
  averageLatency: number;
  /** P50 latency in ms */
  p50Latency: number;
  /** P99 latency in ms */
  p99Latency: number;
  /** Last error message */
  lastError?: string;
  /** Last error timestamp */
  lastErrorTime?: number;
  /** Circuit breaker state */
  circuitState: CircuitState;
  /** When the circuit will close again */
  circuitOpenUntil?: number;
}

export type CircuitState = "closed" | "open" | "half-open";

export interface RequestRecord {
  timestamp: number;
  latency: number;
  success: boolean;
  error?: string;
}

export interface HealthCheckOptions {
  /** Window size for metrics (ms) */
  windowSize: number;
  /** Failure threshold to open circuit (0-1) */
  failureThreshold: number;
  /** Latency threshold to consider degraded (ms) */
  latencyThreshold: number;
  /** Circuit breaker open duration (ms) */
  circuitOpenDuration: number;
  /** Minimum requests before evaluating health */
  minRequests: number;
}

const DEFAULT_OPTIONS: HealthCheckOptions = {
  windowSize: 5 * 60 * 1000, // 5 minutes
  failureThreshold: 0.5, // 50% failure rate
  latencyThreshold: 10000, // 10 seconds
  circuitOpenDuration: 30 * 1000, // 30 seconds
  minRequests: 10,
};

/**
 * Provider health tracker with circuit breaker pattern
 */
export class ProviderHealth {
  private records: RequestRecord[] = [];
  private options: HealthCheckOptions;
  private circuitState: CircuitState = "closed";
  private circuitOpenUntil?: number;

  constructor(options: Partial<HealthCheckOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Record a successful request
   */
  recordSuccess(latency: number): void {
    this.cleanupOldRecords();
    this.records.push({
      timestamp: Date.now(),
      latency,
      success: true,
    });
    this.updateCircuitState();
  }

  /**
   * Record a failed request
   */
  recordFailure(error: string, latency: number): void {
    this.cleanupOldRecords();
    this.records.push({
      timestamp: Date.now(),
      latency,
      success: false,
      error,
    });
    this.updateCircuitState();
  }

  /**
   * Get current health metrics
   */
  getMetrics(): HealthMetrics {
    this.cleanupOldRecords();

    const total = this.records.length;
    const successful = this.records.filter((r) => r.success).length;
    const failed = total - successful;

    const latencies = this.records
      .filter((r) => r.success)
      .map((r) => r.latency)
      .sort((a, b) => a - b);

    const lastError = this.records
      .filter((r) => !r.success)
      .pop();

    return {
      totalRequests: total,
      successfulRequests: successful,
      failedRequests: failed,
      successRate: total > 0 ? successful / total : 1,
      averageLatency: latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0,
      p50Latency: this.calculatePercentile(latencies, 0.5),
      p99Latency: this.calculatePercentile(latencies, 0.99),
      lastError: lastError?.error,
      lastErrorTime: lastError?.timestamp,
      circuitState: this.circuitState,
      circuitOpenUntil: this.circuitOpenUntil,
    };
  }

  /**
   * Check if provider is healthy
   */
  isHealthy(): boolean {
    const metrics = this.getMetrics();

    // Circuit breaker is open
    if (this.circuitState === "open") {
      // Check if we should try half-open
      if (this.circuitOpenUntil && Date.now() >= this.circuitOpenUntil) {
        this.circuitState = "half-open";
        return true;
      }
      return false;
    }

    // Not enough data
    if (metrics.totalRequests < this.options.minRequests) {
      return true;
    }

    // Check success rate
    if (metrics.successRate < this.options.failureThreshold) {
      return false;
    }

    // Check latency
    if (metrics.p99Latency > this.options.latencyThreshold) {
      return false;
    }

    return true;
  }

  /**
   * Get circuit breaker state
   */
  getCircuitState(): CircuitState {
    return this.circuitState;
  }

  /**
   * Mark a half-open request as successful (close circuit)
   */
  markHalfOpenSuccess(): void {
    if (this.circuitState === "half-open") {
      this.circuitState = "closed";
      this.circuitOpenUntil = undefined;
    }
  }

  /**
   * Mark a half-open request as failed (re-open circuit)
   */
  markHalfOpenFailure(): void {
    if (this.circuitState === "half-open") {
      this.openCircuit();
    }
  }

  private cleanupOldRecords(): void {
    const cutoff = Date.now() - this.options.windowSize;
    this.records = this.records.filter((r) => r.timestamp > cutoff);
  }

  private updateCircuitState(): void {
    if (this.circuitState === "open") {
      return; // Circuit is already open
    }

    const metrics = this.getMetrics();

    // Don't evaluate if not enough data
    if (metrics.totalRequests < this.options.minRequests) {
      return;
    }

    // Check if we should open the circuit
    if (metrics.successRate < this.options.failureThreshold) {
      this.openCircuit();
    }
  }

  private openCircuit(): void {
    this.circuitState = "open";
    this.circuitOpenUntil = Date.now() + this.options.circuitOpenDuration;
  }

  private calculatePercentile(sortedValues: number[], percentile: number): number {
    if (sortedValues.length === 0) return 0;
    const index = Math.ceil(sortedValues.length * percentile) - 1;
    return sortedValues[Math.max(0, index)];
  }
}

/**
 * Global health registry for all providers
 */
export class HealthRegistry {
  private healths = new Map<string, ProviderHealth>();
  private options: Partial<HealthCheckOptions>;

  constructor(options: Partial<HealthCheckOptions> = {}) {
    this.options = options;
  }

  /**
   * Get or create health tracker for a provider
   */
  get(providerName: string): ProviderHealth {
    if (!this.healths.has(providerName)) {
      this.healths.set(providerName, new ProviderHealth(this.options));
    }
    return this.healths.get(providerName)!;
  }

  /**
   * Get health metrics for all providers
   */
  getAllMetrics(): Map<string, HealthMetrics> {
    const result = new Map<string, HealthMetrics>();
    for (const [name, health] of this.healths) {
      result.set(name, health.getMetrics());
    }
    return result;
  }

  /**
   * Get list of healthy providers
   */
  getHealthyProviders(): string[] {
    const healthy: string[] = [];
    for (const [name, health] of this.healths) {
      if (health.isHealthy()) {
        healthy.push(name);
      }
    }
    return healthy;
  }

  /**
   * Reset health for a provider
   */
  reset(providerName: string): void {
    this.healths.delete(providerName);
  }

  /**
   * Clear all health data
   */
  clear(): void {
    this.healths.clear();
  }
}

// Global singleton instance
export const globalHealthRegistry = new HealthRegistry();
