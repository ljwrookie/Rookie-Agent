/**
 * Auto-Memory: Contextual Memory Injection (P4-T6)
 *
 * Automatically injects relevant curated memories into the agent context
 * at session start. Implements token budget control to limit memory
 * injection to 10% of total context window.
 */

import { AgentEvent, ToolResult } from "../agent/types.js";
import { MemoryStore, CuratedMemory } from "../memory/store.js";
import { NapiTransport } from "../transport/napi.js";

// ─── Types ───────────────────────────────────────────────────────

export interface AutoMemoryConfig {
  /** Maximum tokens to use for memories (default: 10% of context window) */
  maxMemoryTokens?: number;
  /** Context window size */
  contextWindow?: number;
  /** Maximum number of memories to inject */
  maxMemories?: number;
  /** Minimum confidence for memories */
  minConfidence?: number;
  /** Memory types to include */
  memoryTypes?: CuratedMemory["type"][];
  /** Enable NAPI transport for accurate token counting */
  useNapi?: boolean;
}

export interface MemoryInjection {
  /** Injected memory content */
  content: string;
  /** Token count of injected content */
  tokenCount: number;
  /** Source memories */
  sources: CuratedMemory[];
  /** Whether injection was truncated */
  wasTruncated: boolean;
}

export interface MemoryCandidate {
  type: CuratedMemory["type"];
  content: string;
  confidence: number;
  source: string;
}

// ─── Token Budget Manager ────────────────────────────────────────

/**
 * Manages token budget for memory injection.
 * P4-T6: Ensures memory injection doesn't exceed 10% of context.
 */
export class TokenBudgetManager {
  private maxMemoryTokens: number;
  private napiTransport?: NapiTransport;

  constructor(
    contextWindow: number = 128000,
    memoryBudgetPercent: number = 0.1,
    napiTransport?: NapiTransport
  ) {
    this.maxMemoryTokens = Math.floor(contextWindow * memoryBudgetPercent);
    this.napiTransport = napiTransport;
  }

  /**
   * Get the maximum tokens available for memories.
   */
  getMaxMemoryTokens(): number {
    return this.maxMemoryTokens;
  }

  /**
   * Count tokens accurately using NAPI if available.
   */
  async countTokens(text: string): Promise<number> {
    if (this.napiTransport?.isConnected()) {
      try {
        return await this.napiTransport.countTokens(text);
      } catch {
        // Fall through to estimate
      }
    }
    // Rough estimate: 1 token ≈ 4 chars
    return Math.ceil(text.length / 4);
  }

  /**
   * Fit memories within token budget.
   */
  async fitToBudget(
    memories: CuratedMemory[],
    maxTokens?: number
  ): Promise<{ selected: CuratedMemory[]; totalTokens: number; truncated: boolean }> {
    const budget = maxTokens ?? this.maxMemoryTokens;
    const selected: CuratedMemory[] = [];
    let totalTokens = 0;

    // Sort by confidence (highest first)
    const sorted = [...memories].sort((a, b) => b.confidence - a.confidence);

    for (const memory of sorted) {
      const memoryTokens = await this.countTokens(memory.content);
      
      if (totalTokens + memoryTokens > budget) {
        // Try to truncate this memory if it's the first one
        if (selected.length === 0) {
          const truncated = await this.truncateToFit(memory, budget);
          if (truncated) {
            selected.push(truncated);
            totalTokens = await this.countTokens(truncated.content);
          }
        }
        break;
      }

      selected.push(memory);
      totalTokens += memoryTokens;
    }

    return {
      selected,
      totalTokens,
      truncated: selected.length < memories.length,
    };
  }

  private async truncateToFit(
    memory: CuratedMemory,
    maxTokens: number
  ): Promise<CuratedMemory | null> {
    if (this.napiTransport?.isConnected()) {
      try {
        const result = await this.napiTransport.truncateToTokens(
          memory.content,
          maxTokens
        );
        return {
          ...memory,
          content: result.text,
        };
      } catch {
        // Fall through to simple truncation
      }
    }

    // Simple truncation
    const maxChars = maxTokens * 4;
    if (maxChars < 50) return null; // Too small to be useful

    return {
      ...memory,
      content: memory.content.slice(0, maxChars - 3) + "...",
    };
  }
}

// ─── AutoMemory Engine ───────────────────────────────────────────

/**
 * AutoMemory: automatically captures and injects useful information.
 * P4-T6: Enhanced with token budget control and contextual injection.
 */
export class AutoMemory {
  private store: MemoryStore;
  private config: AutoMemoryConfig;
  private budgetManager: TokenBudgetManager;
  private sessionEvents: AgentEvent[] = [];

  constructor(store: MemoryStore, config: AutoMemoryConfig = {}) {
    this.store = store;
    this.config = {
      contextWindow: config.contextWindow ?? 128000,
      maxMemoryTokens: config.maxMemoryTokens,
      maxMemories: config.maxMemories ?? 10,
      minConfidence: config.minConfidence ?? 0.6,
      memoryTypes: config.memoryTypes ?? ["fact", "decision", "pattern", "api_pattern", "convention"],
      useNapi: config.useNapi ?? true,
    };

    this.budgetManager = new TokenBudgetManager(
      this.config.contextWindow,
      0.1, // 10% budget for memories
      config.useNapi ? undefined : undefined // NAPI transport would be set separately
    );
  }

  /**
   * Set NAPI transport for accurate token counting.
   */
  setNapiTransport(transport: NapiTransport): void {
    this.budgetManager = new TokenBudgetManager(
      this.config.contextWindow!,
      0.1,
      transport
    );
  }

  /**
   * Query and prepare memories for injection at session start.
   * P4-T6: Main entry point for memory context injection.
   */
  async prepareMemoryContext(
    sessionContext: {
      projectRoot?: string;
      taskDescription?: string;
      relevantFiles?: string[];
    } = {}
  ): Promise<MemoryInjection> {
    const { projectRoot } = sessionContext;

    // Build search query from context
    const searchQuery = this.buildSearchQuery(sessionContext);

    // Search for relevant memories
    const searchResult = await this.store.searchWithSummary(searchQuery, {
      limit: this.config.maxMemories! * 2, // Get more than needed for filtering
      minConfidence: this.config.minConfidence,
      types: this.config.memoryTypes,
    });

    // Filter to relevant types
    let memories = searchResult.memories.filter((m) =>
      this.config.memoryTypes!.includes(m.type)
    );

    // Boost memories from same project
    if (projectRoot) {
      memories = memories.map((m) => ({
        ...m,
        confidence: m.source.includes(projectRoot)
          ? Math.min(1, m.confidence + 0.1)
          : m.confidence,
      }));
    }

    // Sort by confidence and fit to budget
    const { selected, totalTokens, truncated } = await this.budgetManager.fitToBudget(
      memories,
      this.config.maxMemoryTokens
    );

    // Format for injection
    const content = this.formatMemoriesForInjection(selected);

    return {
      content,
      tokenCount: totalTokens,
      sources: selected,
      wasTruncated: truncated,
    };
  }

  /**
   * Feed an agent event for analysis.
   * Returns a memory candidate if the event contains useful information.
   */
  async evaluate(event: AgentEvent): Promise<MemoryCandidate | null> {
    this.sessionEvents.push(event);

    if (event.type === "tool_result") {
      return this.evaluateToolResult(event.result);
    }

    return null;
  }

  /**
   * Persist a confirmed memory candidate.
   */
  async persist(candidate: MemoryCandidate): Promise<void> {
    const memory: CuratedMemory = {
      id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: candidate.type,
      content: candidate.content,
      confidence: candidate.confidence,
      source: candidate.source,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
    };
    await this.store.saveCurated(memory);
  }

  /**
   * Auto-evaluate and persist all high-confidence candidates from the session.
   * Called at session end.
   */
  async flushSession(): Promise<number> {
    let persisted = 0;
    for (const event of this.sessionEvents) {
      const candidate = await this.evaluate(event);
      if (candidate && candidate.confidence >= 0.7) {
        await this.persist(candidate);
        persisted++;
      }
    }
    this.sessionEvents = [];
    return persisted;
  }

  // ─── Private Methods ────────────────────────────────────────────

  private buildSearchQuery(context: {
    projectRoot?: string;
    taskDescription?: string;
    relevantFiles?: string[];
  }): string {
    const parts: string[] = [];

    if (context.taskDescription) {
      // Extract key terms from task description
      const keywords = context.taskDescription
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5);
      parts.push(...keywords);
    }

    if (context.relevantFiles && context.relevantFiles.length > 0) {
      // Extract file extensions and base names
      for (const file of context.relevantFiles.slice(0, 3)) {
        const basename = file.split("/").pop()?.replace(/\.[^.]+$/, "");
        if (basename) parts.push(basename);
      }
    }

    return parts.join(" OR ") || "*";
  }

  private formatMemoriesForInjection(memories: CuratedMemory[]): string {
    if (memories.length === 0) return "";

    const lines: string[] = ["## Relevant Context from Previous Sessions"];

    for (const memory of memories) {
      const typeEmoji = this.getTypeEmoji(memory.type);
      lines.push(`\n${typeEmoji} **${this.capitalize(memory.type)}** (${Math.round(memory.confidence * 100)}% confidence)`);
      lines.push(memory.content);
    }

    lines.push("\n---");
    return lines.join("\n");
  }

  private getTypeEmoji(type: CuratedMemory["type"]): string {
    const emojis: Record<string, string> = {
      fact: "📚",
      preference: "⚙️",
      decision: "✅",
      pattern: "🔄",
      debug_tip: "🐛",
      build_command: "🔨",
      env_issue: "🌍",
      api_pattern: "🔌",
      convention: "📋",
    };
    return emojis[type] || "💡";
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
  }

  private evaluateToolResult(result: ToolResult): MemoryCandidate | null {
    // Detect successful build commands
    if (result.name === "shell_execute" && !result.error) {
      const output = result.output;

      // Build commands
      const buildPatterns = [
        /(?:npm|pnpm|yarn)\s+(?:run\s+)?build/i,
        /cargo\s+build/i,
        /make\s+/i,
        /tsc\b/i,
        /webpack\b/i,
        /vite\s+build/i,
      ];

      for (const pattern of buildPatterns) {
        if (pattern.test(output) && !output.includes("error") && !output.includes("ERROR")) {
          return {
            type: "build_command",
            content: `Build command executed successfully. Output indicates the build process completed.`,
            confidence: 0.6,
            source: `tool:${result.name}`,
          };
        }
      }

      // Detect environment issues
      if (
        output.includes("command not found") ||
        output.includes("MODULE_NOT_FOUND") ||
        output.includes("ENOENT")
      ) {
        return {
          type: "env_issue",
          content: `Environment issue detected: ${output.slice(0, 200)}`,
          confidence: 0.8,
          source: `tool:${result.name}`,
        };
      }
    }

    // Detect debug tips: error followed by successful resolution
    if (result.name === "shell_execute" && result.error) {
      return {
        type: "debug_tip",
        content: `Error encountered: ${result.error.slice(0, 200)}`,
        confidence: 0.5,
        source: `tool:${result.name}`,
      };
    }

    return null;
  }
}

// ─── Factory Functions ───────────────────────────────────────────

export function createAutoMemory(
  store: MemoryStore,
  config?: AutoMemoryConfig
): AutoMemory {
  return new AutoMemory(store, config);
}

export function createTokenBudgetManager(
  contextWindow: number,
  memoryBudgetPercent: number = 0.1,
  napiTransport?: NapiTransport
): TokenBudgetManager {
  return new TokenBudgetManager(contextWindow, memoryBudgetPercent, napiTransport);
}
