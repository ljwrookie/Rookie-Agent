/**
 * Token usage tracking and cost calculation.
 * Accumulates usage across LLM calls within a session.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostEntry {
  model: string;
  usage: TokenUsage;
  cost: number;       // USD
  timestamp: number;
}

// Pricing per 1M tokens (approximate, input/output)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  "gpt-4o":           { input: 2.50,  output: 10.00 },
  "gpt-4o-mini":      { input: 0.15,  output: 0.60  },
  "gpt-4-turbo":      { input: 10.00, output: 30.00 },
  "gpt-3.5-turbo":    { input: 0.50,  output: 1.50  },
  // Anthropic
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-3-5-haiku-20241022": { input: 0.80, output: 4.00 },
  "claude-3-opus-20240229":   { input: 15.00, output: 75.00 },
  // Default fallback
  "default":          { input: 1.00,  output: 3.00  },
};

function getPricing(model: string): { input: number; output: number } {
  // Try exact match first, then prefix match
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key)) return pricing;
  }
  return MODEL_PRICING["default"];
}

export class TokenTracker {
  private entries: CostEntry[] = [];
  private totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private totalCost = 0;

  /**
   * Record a new LLM call's token usage.
   */
  record(model: string, usage: TokenUsage): CostEntry {
    const pricing = getPricing(model);
    const cost =
      (usage.promptTokens / 1_000_000) * pricing.input +
      (usage.completionTokens / 1_000_000) * pricing.output;

    const entry: CostEntry = {
      model,
      usage,
      cost,
      timestamp: Date.now(),
    };

    this.entries.push(entry);
    this.totalUsage.promptTokens += usage.promptTokens;
    this.totalUsage.completionTokens += usage.completionTokens;
    this.totalUsage.totalTokens += usage.totalTokens;
    this.totalCost += cost;

    return entry;
  }

  getTotalUsage(): TokenUsage {
    return { ...this.totalUsage };
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getEntries(): CostEntry[] {
    return [...this.entries];
  }

  /**
   * Format a summary string for display.
   */
  formatSummary(): string {
    const u = this.totalUsage;
    return (
      `Tokens: ${u.totalTokens.toLocaleString()} ` +
      `(${u.promptTokens.toLocaleString()} in / ${u.completionTokens.toLocaleString()} out) ` +
      `| Cost: $${this.totalCost.toFixed(4)} ` +
      `| Calls: ${this.entries.length}`
    );
  }

  reset(): void {
    this.entries = [];
    this.totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    this.totalCost = 0;
  }
}
