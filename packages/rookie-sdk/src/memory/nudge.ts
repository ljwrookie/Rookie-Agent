/**
 * Memory Nudge Engine (P4-T5)
 *
 * Automatically analyzes recent messages and extracts patterns
 * for memory storage. Supports both LLM-based and rule-based extraction.
 */

import { Message, AgentEvent } from "../agent/types.js";
import { MemoryStore, CuratedMemory } from "./store.js";
import { LLMSummarizer } from "./summarizer.js";

// ─── Types ───────────────────────────────────────────────────────

export interface NudgeConfig {
  /** Analyze every N messages */
  analyzeEveryN: number;
  /** Minimum confidence to persist */
  minConfidence: number;
  /** Enable LLM extraction */
  useLLM: boolean;
  /** Enable rule extraction */
  useRules: boolean;
  /** Maximum memories per analysis */
  maxMemoriesPerAnalysis: number;
  /** Cooldown between analyses (ms) */
  cooldownMs: number;
}

export interface NudgeAnalysis {
  /** Whether any memories were extracted */
  hasMemories: boolean;
  /** Extracted memories */
  memories: CuratedMemory[];
  /** Analysis metadata */
  metadata: {
    messagesAnalyzed: number;
    llmExtracted: number;
    ruleExtracted: number;
    durationMs: number;
  };
}

export interface NudgePattern {
  /** Pattern type */
  type: CuratedMemory["type"];
  /** Pattern description */
  description: string;
  /** Confidence score */
  confidence: number;
  /** Source messages */
  sources: string[];
}

// ─── Memory Nudge Engine ─────────────────────────────────────────

/**
 * Memory Nudge Engine - analyzes conversations for extractable memories.
 * P4-T5: Automatically extracts patterns from agent sessions.
 */
export class MemoryNudgeEngine {
  private store: MemoryStore;
  private config: NudgeConfig;
  private llmSummarizer?: LLMSummarizer;
  
  // State
  private messageBuffer: Message[] = [];
  private lastAnalysisTime = 0;
  private analysisCount = 0;

  constructor(
    store: MemoryStore,
    config: Partial<NudgeConfig> = {},
    llmSummarizer?: LLMSummarizer
  ) {
    this.store = store;
    this.config = {
      analyzeEveryN: config.analyzeEveryN ?? 5,
      minConfidence: config.minConfidence ?? 0.7,
      useLLM: config.useLLM ?? false, // Default to rules for speed
      useRules: config.useRules ?? true,
      maxMemoriesPerAnalysis: config.maxMemoriesPerAnalysis ?? 3,
      cooldownMs: config.cooldownMs ?? 5000,
    };
    this.llmSummarizer = llmSummarizer;
  }

  /**
   * Process an agent event for potential memory extraction.
   * Call this from the main react loop.
   */
  async processEvent(event: AgentEvent, sessionId: string): Promise<NudgeAnalysis | null> {
    // Extract message from event
    const message = this.eventToMessage(event);
    if (!message) return null;

    // Add to buffer
    this.messageBuffer.push(message);

    // Check if we should analyze
    if (!this.shouldAnalyze()) return null;

    // Perform analysis
    return this.analyze(sessionId);
  }

  /**
   * Force analysis of current buffer.
   */
  async analyze(sessionId: string): Promise<NudgeAnalysis> {
    const startTime = Date.now();
    this.lastAnalysisTime = startTime;
    this.analysisCount++;

    const memories: CuratedMemory[] = [];
    let llmExtracted = 0;
    let ruleExtracted = 0;

    // Get messages to analyze
    const messagesToAnalyze = this.getMessagesForAnalysis();

    // Rule-based extraction
    if (this.config.useRules) {
      const rulePatterns = await this.extractWithRules(messagesToAnalyze, sessionId);
      for (const pattern of rulePatterns.slice(0, this.config.maxMemoriesPerAnalysis)) {
        const memory = await this.patternToMemory(pattern, sessionId);
        if (memory.confidence >= this.config.minConfidence) {
          memories.push(memory);
          await this.store.saveCurated(memory);
          ruleExtracted++;
        }
      }
    }

    // LLM-based extraction (if enabled and room for more)
    if (this.config.useLLM && this.llmSummarizer && 
        memories.length < this.config.maxMemoriesPerAnalysis) {
      const llmPatterns = await this.extractWithLLM(messagesToAnalyze, sessionId);
      const remaining = this.config.maxMemoriesPerAnalysis - memories.length;
      for (const pattern of llmPatterns.slice(0, remaining)) {
        const memory = await this.patternToMemory(pattern, sessionId);
        if (memory.confidence >= this.config.minConfidence) {
          memories.push(memory);
          await this.store.saveCurated(memory);
          llmExtracted++;
        }
      }
    }

    // Clear analyzed messages (keep last few for context)
    this.messageBuffer = this.messageBuffer.slice(-3);

    const durationMs = Date.now() - startTime;

    return {
      hasMemories: memories.length > 0,
      memories,
      metadata: {
        messagesAnalyzed: messagesToAnalyze.length,
        llmExtracted,
        ruleExtracted,
        durationMs,
      },
    };
  }

  /**
   * Get current analysis statistics.
   */
  getStats(): {
    analysisCount: number;
    bufferedMessages: number;
    lastAnalysisTime: number;
  } {
    return {
      analysisCount: this.analysisCount,
      bufferedMessages: this.messageBuffer.length,
      lastAnalysisTime: this.lastAnalysisTime,
    };
  }

  /**
   * Reset the engine state.
   */
  reset(): void {
    this.messageBuffer = [];
    this.lastAnalysisTime = 0;
    this.analysisCount = 0;
  }

  // ─── Private Methods ────────────────────────────────────────────

  private shouldAnalyze(): boolean {
    // Check buffer size
    if (this.messageBuffer.length < this.config.analyzeEveryN) return false;

    // Check cooldown
    const now = Date.now();
    if (now - this.lastAnalysisTime < this.config.cooldownMs) return false;

    return true;
  }

  private getMessagesForAnalysis(): Message[] {
    // Get the last N messages for analysis
    return this.messageBuffer.slice(-this.config.analyzeEveryN);
  }

  private eventToMessage(event: AgentEvent): Message | null {
    switch (event.type) {
      case "thinking":
        return {
          role: "assistant",
          content: event.content,
        };
      case "tool_result":
        return {
          role: "tool",
          content: event.result.output || event.result.error || "",
        };
      case "response":
        return {
          role: "assistant",
          content: event.content,
        };
      default:
        return null;
    }
  }

  private async extractWithRules(
    messages: Message[],
    sessionId: string
  ): Promise<NudgePattern[]> {
    const patterns: NudgePattern[] = [];

    // Analyze tool results for patterns
    const toolResults = messages.filter((m) => m.role === "tool");
    for (const result of toolResults) {
      const content = result.content || "";

      // Pattern: Successful build command
      if (this.isSuccessfulBuild(content)) {
        patterns.push({
          type: "build_command",
          description: "Build command executed successfully",
          confidence: 0.75,
          sources: [sessionId],
        });
      }

      // Pattern: Environment issue
      if (this.isEnvironmentIssue(content)) {
        patterns.push({
          type: "env_issue",
          description: this.extractEnvironmentIssue(content),
          confidence: 0.85,
          sources: [sessionId],
        });
      }

      // Pattern: Debug tip
      if (this.isDebugTip(content)) {
        patterns.push({
          type: "debug_tip",
          description: this.extractDebugTip(content),
          confidence: 0.7,
          sources: [sessionId],
        });
      }
    }

    // Analyze assistant messages for API patterns
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    for (const msg of assistantMsgs) {
      const content = msg.content || "";

      if (this.isAPIPattern(content)) {
        patterns.push({
          type: "api_pattern",
          description: this.extractAPIPattern(content),
          confidence: 0.65,
          sources: [sessionId],
        });
      }

      if (this.isConvention(content)) {
        patterns.push({
          type: "convention",
          description: this.extractConvention(content),
          confidence: 0.7,
          sources: [sessionId],
        });
      }
    }

    return patterns;
  }

  private async extractWithLLM(
    messages: Message[],
    sessionId: string
  ): Promise<NudgePattern[]> {
    if (!this.llmSummarizer) return [];

    try {
      const result = await this.llmSummarizer.summarize(messages, {
        maxSummaryTokens: 100,
      });

      if (result.confidence < this.config.minConfidence) return [];

      return [{
        type: "fact",
        description: result.summary,
        confidence: result.confidence,
        sources: [sessionId],
      }];
    } catch {
      return [];
    }
  }

  private async patternToMemory(pattern: NudgePattern, sessionId: string): Promise<CuratedMemory> {
    const now = Math.floor(Date.now() / 1000);
    return {
      id: `nudge_${sessionId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: pattern.type,
      content: pattern.description,
      confidence: pattern.confidence,
      source: `nudge:${sessionId}:${pattern.sources.join(",")}`,
      createdAt: now,
      lastUsedAt: now,
      useCount: 0,
    };
  }

  // ─── Pattern Detection Rules ────────────────────────────────────

  private isSuccessfulBuild(content: string): boolean {
    const buildPatterns = [
      /(?:npm|pnpm|yarn)\s+(?:run\s+)?build\s+.*succe/i,
      /cargo\s+build.*(?:Compiling|Finished)/i,
      /make.*(?:built|success)/i,
      /tsc.*(?:success|no error)/i,
      /webpack.*(?:compiled|success)/i,
      /vite\s+build.*success/i,
    ];
    return buildPatterns.some((p) => p.test(content)) && 
           !/error|fail/i.test(content.slice(0, 500));
  }

  private isEnvironmentIssue(content: string): boolean {
    const issuePatterns = [
      /command not found/i,
      /MODULE_NOT_FOUND/i,
      /ENOENT/i,
      /EACCES/i,
      /permission denied/i,
      /missing.*dependency/i,
    ];
    return issuePatterns.some((p) => p.test(content));
  }

  private extractEnvironmentIssue(content: string): string {
    const lines = content.split("\n");
    for (const line of lines) {
      if (/command not found|MODULE_NOT_FOUND|ENOENT|EACCES/i.test(line)) {
        return `Environment issue: ${line.trim().slice(0, 200)}`;
      }
    }
    return "Environment issue detected";
  }

  private isDebugTip(content: string): boolean {
    return /(?:fix|solution|workaround|resolved).*error/i.test(content) ||
           /error.*(?:fixed|resolved|solved)/i.test(content);
  }

  private extractDebugTip(content: string): string {
    const lines = content.split("\n");
    for (const line of lines) {
      if (/(?:fix|solution|workaround)/i.test(line)) {
        return `Debug tip: ${line.trim().slice(0, 200)}`;
      }
    }
    return "Debug tip from session";
  }

  private isAPIPattern(content: string): boolean {
    return /(?:API|endpoint|route|request|response).*\b(?:GET|POST|PUT|DELETE|PATCH)\b/i.test(content) ||
           /\b(?:GET|POST|PUT|DELETE|PATCH)\b.*\/(?:api|v\d+)/i.test(content);
  }

  private extractAPIPattern(content: string): string {
    const match = content.match(/\b(?:GET|POST|PUT|DELETE|PATCH)\b[^\n]{0,100}/i);
    return match ? `API pattern: ${match[0].trim()}` : "API usage pattern";
  }

  private isConvention(content: string): boolean {
    return /(?:convention|standard|pattern|best practice|should|always|never)\b/i.test(content) &&
           content.length > 50;
  }

  private extractConvention(content: string): string {
    const sentences = content.match(/[^.!?]+[.!?]+/g) || [];
    for (const sentence of sentences) {
      if (/(?:convention|standard|pattern|best practice|should|always)/i.test(sentence)) {
        return `Convention: ${sentence.trim().slice(0, 200)}`;
      }
    }
    return "Project convention identified";
  }
}

// ─── Integration Helper ──────────────────────────────────────────

/**
 * Create a nudge engine with default configuration.
 */
export function createNudgeEngine(
  store: MemoryStore,
  llmSummarizer?: LLMSummarizer,
  config?: Partial<NudgeConfig>
): MemoryNudgeEngine {
  return new MemoryNudgeEngine(store, config, llmSummarizer);
}

/**
 * Integration with react.ts main loop.
 * Usage: Add to runReAct generator to process events.
 */
export async function processEventForNudge(
  engine: MemoryNudgeEngine,
  event: AgentEvent,
  sessionId: string
): Promise<NudgeAnalysis | null> {
  return engine.processEvent(event, sessionId);
}
