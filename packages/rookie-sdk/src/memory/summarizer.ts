/**
 * Memory Summarizer (P4-T4)
 *
 * Provides LLM-based and rule-based summarization for cross-session memories.
 * Summaries are cached to curated_memory table for efficient retrieval.
 */

import { MemoryStore, CuratedMemory } from "./store.js";
import { Message } from "../agent/types.js";

// ─── Types ───────────────────────────────────────────────────────

export interface SummarizerConfig {
  /** Maximum length of summary in tokens (approximate) */
  maxSummaryTokens?: number;
  /** Minimum confidence threshold for summaries */
  minConfidence?: number;
  /** Cache summaries to curated_memory */
  cacheSummaries?: boolean;
  /** TTL for cached summaries in seconds */
  cacheTtl?: number;
}

export interface SummaryResult {
  /** Generated summary text */
  summary: string;
  /** Confidence score (0-1) */
  confidence: number;
  /** Source messages that contributed to summary */
  sourceCount: number;
  /** Cached memory ID if cached */
  cachedId?: string;
}

export interface SearchWithSummaryOptions {
  /** Query string */
  query: string;
  /** Maximum results */
  limit?: number;
  /** Include LLM-generated summaries */
  includeSummaries?: boolean;
  /** Minimum relevance score */
  minRelevance?: number;
}

export interface SearchWithSummaryResult {
  /** Original memory entries */
  memories: CuratedMemory[];
  /** LLM-generated summary of results */
  summary?: string;
  /** Total relevance score */
  totalRelevance: number;
}

// ─── Base Summarizer Interface ───────────────────────────────────

export interface Summarizer {
  /** Generate a summary from messages */
  summarize(messages: Message[], config?: SummarizerConfig): Promise<SummaryResult>;
  /** Summarize text content directly */
  summarizeText(content: string, config?: SummarizerConfig): Promise<SummaryResult>;
}

// ─── LLM-based Summarizer ────────────────────────────────────────

/**
 * LLM-based summarizer using model provider.
 * P4-T4: Generates high-quality summaries using LLM.
 */
export class LLMSummarizer implements Summarizer {
  private modelProvider: {
    complete(prompt: string, options?: { maxTokens?: number }): Promise<string>;
  };
  private memoryStore?: MemoryStore;
  private config: SummarizerConfig;

  constructor(
    modelProvider: {
      complete(prompt: string, options?: { maxTokens?: number }): Promise<string>;
    },
    memoryStore?: MemoryStore,
    config: SummarizerConfig = {}
  ) {
    this.modelProvider = modelProvider;
    this.memoryStore = memoryStore;
    this.config = {
      maxSummaryTokens: config.maxSummaryTokens ?? 150,
      minConfidence: config.minConfidence ?? 0.7,
      cacheSummaries: config.cacheSummaries ?? true,
      cacheTtl: config.cacheTtl ?? 86400 * 30, // 30 days
    };
  }

  async summarize(messages: Message[], config?: SummarizerConfig): Promise<SummaryResult> {
    const cfg = { ...this.config, ...config };
    
    // Build prompt from messages
    const content = this.messagesToText(messages);
    return this.summarizeText(content, cfg);
  }

  async summarizeText(content: string, config?: SummarizerConfig): Promise<SummaryResult> {
    const cfg = { ...this.config, ...config };
    
    const prompt = this.buildSummaryPrompt(content);
    
    try {
      const summary = await this.modelProvider.complete(prompt, {
        maxTokens: cfg.maxSummaryTokens,
      });

      // Calculate confidence based on summary quality
      const confidence = this.calculateConfidence(summary, content);

      const result: SummaryResult = {
        summary: summary.trim(),
        confidence,
        sourceCount: 1,
      };

      // Cache if enabled and confidence is high enough
      if (cfg.cacheSummaries && this.memoryStore && confidence >= cfg.minConfidence!) {
        result.cachedId = await this.cacheSummary(result, content);
      }

      return result;
    } catch (error) {
      // Fallback to simple extraction
      return {
        summary: this.extractiveFallback(content),
        confidence: 0.5,
        sourceCount: 1,
      };
    }
  }

  private buildSummaryPrompt(content: string): string {
    return `Summarize the following content concisely, capturing the key points and insights:

${content.slice(0, 4000)}

Summary:`;
  }

  private calculateConfidence(summary: string, original: string): number {
    let score = 0.7; // Base score

    // Bonus for appropriate length
    const summaryLen = summary.length;
    const originalLen = original.length;
    const ratio = summaryLen / originalLen;
    if (ratio > 0.05 && ratio < 0.3) {
      score += 0.15;
    }

    // Bonus for containing key information
    const summaryWords = new Set(summary.toLowerCase().split(/\s+/));
    const originalWords = original.toLowerCase().split(/\s+/);
    const keyWords = originalWords.filter((w) => w.length > 5);
    const matchedKeyWords = keyWords.filter((w) => summaryWords.has(w));
    if (keyWords.length > 0) {
      const coverage = matchedKeyWords.length / Math.min(keyWords.length, 20);
      score += coverage * 0.15;
    }

    return Math.min(1.0, score);
  }

  private extractiveFallback(content: string): string {
    // Simple extractive summary: take first and last sentences
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
    if (sentences.length <= 2) return content.slice(0, 500);
    
    const firstSentence = sentences[0] ?? content.slice(0, 250);
    const lastSentence = sentences[sentences.length - 1] ?? "";
    return firstSentence.trim() + " " + lastSentence.trim();
  }

  private messagesToText(messages: Message[]): string {
    return messages
      .map((m) => `[${m.role}]: ${m.content}`)
      .join("\n\n");
  }

  private async cacheSummary(result: SummaryResult, source: string): Promise<string> {
    if (!this.memoryStore) return "";

    const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    await this.memoryStore.saveCurated({
      id,
      type: "fact",
      content: result.summary,
      confidence: result.confidence,
      source: `llm_summarizer:${source.slice(0, 100)}`,
      createdAt: Math.floor(Date.now() / 1000),
      lastUsedAt: Math.floor(Date.now() / 1000),
      useCount: 0,
    });

    return id;
  }
}

// ─── Rule-based Summarizer ───────────────────────────────────────

/**
 * Rule-based summarizer using heuristics.
 * P4-T4: Fast, deterministic summaries without LLM calls.
 */
export class RuleSummarizer implements Summarizer {
  private memoryStore?: MemoryStore;
  private config: SummarizerConfig;

  constructor(memoryStore?: MemoryStore, config: SummarizerConfig = {}) {
    this.memoryStore = memoryStore;
    this.config = {
      maxSummaryTokens: config.maxSummaryTokens ?? 100,
      minConfidence: config.minConfidence ?? 0.6,
      cacheSummaries: config.cacheSummaries ?? true,
      ...config,
    };
  }

  async summarize(messages: Message[], config?: SummarizerConfig): Promise<SummaryResult> {
    const cfg = { ...this.config, ...config };
    
    // Extract key information using rules
    const keyPoints: string[] = [];
    const decisions: string[] = [];
    const patterns: string[] = [];

    for (const msg of messages) {
      const content = msg.content || "";
      
      // Extract decisions (lines with keywords)
      if (/\b(decided|decision|chose|selected|opted)\b/i.test(content)) {
        const lines = content.split(/\n/).filter((l) => 
          /\b(decided|decision|chose|selected|opted)\b/i.test(l)
        );
        decisions.push(...lines);
      }

      // Extract patterns (repeated structures)
      if (/\b(pattern|always|usually|typically|convention)\b/i.test(content)) {
        patterns.push(content);
      }

      // Extract key facts (short, informative lines)
      const lines = content.split(/\n/).filter((l) => {
        const trimmed = l.trim();
        return trimmed.length > 20 && trimmed.length < 200 && 
               (trimmed.includes(":") || trimmed.includes("is") || trimmed.includes("are"));
      });
      keyPoints.push(...lines.slice(0, 3));
    }

    // Build summary
    const parts: string[] = [];
    if (decisions.length > 0) {
      parts.push("Decisions: " + decisions.slice(0, 2).join("; "));
    }
    if (patterns.length > 0) {
      parts.push("Patterns: " + patterns.slice(0, 2).join("; "));
    }
    if (keyPoints.length > 0) {
      parts.push("Key points: " + keyPoints.slice(0, 3).join("; "));
    }

    const summary = parts.join("\n") || "General discussion with no specific decisions.";
    const confidence = Math.min(0.9, 0.5 + (decisions.length * 0.1) + (patterns.length * 0.05));

    const result: SummaryResult = {
      summary: summary.slice(0, cfg.maxSummaryTokens! * 4),
      confidence,
      sourceCount: messages.length,
    };

    // Cache if enabled
    if (cfg.cacheSummaries && this.memoryStore && confidence >= cfg.minConfidence!) {
      result.cachedId = await this.cacheSummary(result, messages);
    }

    return result;
  }

  async summarizeText(content: string, config?: SummarizerConfig): Promise<SummaryResult> {
    // Convert to single message and summarize
    const message: Message = {
      role: "system",
      content,
    };
    return this.summarize([message], config);
  }

  private async cacheSummary(result: SummaryResult, messages: Message[]): Promise<string> {
    if (!this.memoryStore) return "";

    const id = `rule_summary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    await this.memoryStore.saveCurated({
      id,
      type: "pattern",
      content: result.summary,
      confidence: result.confidence,
      source: `rule_summarizer:${messages.length}_messages`,
      createdAt: Math.floor(Date.now() / 1000),
      lastUsedAt: Math.floor(Date.now() / 1000),
      useCount: 0,
    });

    return id;
  }
}

// ─── Memory Store Extensions (P4-T4) ─────────────────────────────

/**
 * Extended MemoryStore with summary capabilities.
 */
export class SummarizingMemoryStore {
  private store: MemoryStore;
  private llmSummarizer?: LLMSummarizer;
  private ruleSummarizer: RuleSummarizer;

  constructor(
    store: MemoryStore,
    llmSummarizer?: LLMSummarizer
  ) {
    this.store = store;
    this.llmSummarizer = llmSummarizer;
    this.ruleSummarizer = new RuleSummarizer(store);
  }

  /**
   * Search memories with optional LLM summary.
   * P4-T4: Returns search results with LLM-generated summary.
   */
  async searchWithSummary(
    options: SearchWithSummaryOptions
  ): Promise<SearchWithSummaryResult> {
    const { query, limit = 10, includeSummaries = true, minRelevance = 0.5 } = options;

    // Search curated memories
    const memories = await this.store.searchCurated(query, limit);
    
    // Filter by relevance (using confidence as proxy)
    const relevantMemories = memories.filter((m) => m.confidence >= minRelevance);

    let summary: string | undefined;
    let totalRelevance = 0;

    if (relevantMemories.length > 0) {
      totalRelevance = relevantMemories.reduce((sum, m) => sum + m.confidence, 0);

      // Generate summary if requested and LLM available
      if (includeSummaries && this.llmSummarizer && relevantMemories.length >= 3) {
        const messages: Message[] = relevantMemories.map((m) => ({
          role: "system",
          content: m.content,
        }));

        try {
          const summaryResult = await this.llmSummarizer.summarize(messages, {
            maxSummaryTokens: 100,
          });
          summary = summaryResult.summary;
        } catch {
          // Ignore summary errors
        }
      }
    }

    return {
      memories: relevantMemories,
      summary,
      totalRelevance,
    };
  }

  /**
   * Summarize a session and save to curated memory.
   */
  async summarizeSession(
    _sessionId: string,
    messages: Message[],
    useLLM: boolean = false
  ): Promise<SummaryResult> {
    const summarizer = useLLM && this.llmSummarizer ? this.llmSummarizer : this.ruleSummarizer;
    
    const result = await summarizer.summarize(messages, {
      cacheSummaries: true,
    });

    // Save with session reference
    if (result.cachedId) {
      // Update the cached entry with session info
      // This would require an update method in MemoryStore
    }

    return result;
  }
}

// ─── Factory Functions ───────────────────────────────────────────

export function createLLMSummarizer(
  modelProvider: {
    complete(prompt: string, options?: { maxTokens?: number }): Promise<string>;
  },
  memoryStore?: MemoryStore,
  config?: SummarizerConfig
): LLMSummarizer {
  return new LLMSummarizer(modelProvider, memoryStore, config);
}

export function createRuleSummarizer(
  memoryStore?: MemoryStore,
  config?: SummarizerConfig
): RuleSummarizer {
  return new RuleSummarizer(memoryStore, config);
}
