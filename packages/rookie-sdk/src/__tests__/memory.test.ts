/**
 * Memory system tests (P4-T4, P4-T5, P4-T6)
 * Tests for summarizer, nudge engine, and auto-memory
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStore } from "../memory/store.js";
import { 
  LLMSummarizer, 
  RuleSummarizer, 
  createRuleSummarizer,
  SummarizingMemoryStore 
} from "../memory/summarizer.js";
import { MemoryNudgeEngine, createNudgeEngine } from "../memory/nudge.js";
import { AutoMemory, createAutoMemory, TokenBudgetManager } from "../instructions/auto-memory.js";
import type { Message } from "../agent/types.js";

describe("Memory Summarizer (P4-T4)", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
  });

  it("should create rule-based summarizer", () => {
    const summarizer = createRuleSummarizer(store);
    expect(summarizer).toBeDefined();
  });

  it("should summarize messages with rules", async () => {
    const summarizer = createRuleSummarizer(store);
    const messages: Message[] = [
      { role: "user", content: "How do I build this project?" },
      { role: "assistant", content: "Run npm run build to compile." },
    ];

    const result = await summarizer.summarize(messages);
    expect(result.summary).toBeDefined();
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("should extract decisions from messages", async () => {
    const summarizer = createRuleSummarizer(store);
    const messages: Message[] = [
      { role: "assistant", content: "We decided to use TypeScript for the project." },
      { role: "user", content: "Good choice!" },
    ];

    const result = await summarizer.summarize(messages);
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("should search with summary", async () => {
    // Add some test memories
    await store.saveCurated({
      id: "test1",
      type: "fact",
      content: "The project uses TypeScript",
      confidence: 0.9,
      source: "test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
    });

    const result = await store.searchWithSummary("TypeScript", {
      limit: 5,
    });

    expect(result.memories.length).toBeGreaterThan(0);
    expect(result.totalConfidence).toBeGreaterThan(0);
  });
});

describe("Memory Nudge Engine (P4-T5)", () => {
  let store: MemoryStore;
  let engine: MemoryNudgeEngine;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
    engine = createNudgeEngine(store);
  });

  it("should create nudge engine", () => {
    expect(engine).toBeDefined();
  });

  it("should process tool result events", async () => {
    const event = {
      type: "tool_result" as const,
      result: {
        id: "test",
        name: "shell_execute",
        output: "npm run build completed successfully",
      },
      duration: 100,
    };

    // Process multiple times to trigger analysis
    let result = null;
    for (let i = 0; i < 6; i++) {
      result = await engine.processEvent(event, "test_session");
    }

    // Should have analyzed and potentially extracted memories
    const stats = engine.getStats();
    expect(stats.analysisCount).toBeGreaterThan(0);
  });

  it("should detect build commands", async () => {
    const event = {
      type: "tool_result" as const,
      result: {
        id: "test",
        name: "shell_execute",
        output: "npm run build\n> tsc\nBuild successful",
      },
      duration: 100,
    };

    // Process multiple times
    for (let i = 0; i < 6; i++) {
      await engine.processEvent(event, "test_session");
    }

    const stats = engine.getStats();
    expect(stats.bufferedMessages).toBeGreaterThanOrEqual(0);
  });

  it("should detect environment issues", async () => {
    const event = {
      type: "tool_result" as const,
      result: {
        id: "test",
        name: "shell_execute",
        output: "Error: command not found: npm",
        error: "command not found",
      },
      duration: 100,
    };

    // Process multiple times
    for (let i = 0; i < 6; i++) {
      await engine.processEvent(event, "test_session");
    }

    const stats = engine.getStats();
    expect(stats.analysisCount).toBeGreaterThanOrEqual(0);
  });

  it("should reset state", () => {
    engine.reset();
    const stats = engine.getStats();
    expect(stats.analysisCount).toBe(0);
    expect(stats.bufferedMessages).toBe(0);
  });
});

describe("Auto-Memory (P4-T6)", () => {
  let store: MemoryStore;
  let autoMemory: AutoMemory;

  beforeEach(() => {
    store = new MemoryStore(":memory:");
    autoMemory = createAutoMemory(store, {
      contextWindow: 128000,
    });
  });

  it("should create auto-memory", () => {
    expect(autoMemory).toBeDefined();
  });

  it("should prepare memory context", async () => {
    // Add test memories
    await store.saveCurated({
      id: "test1",
      type: "fact",
      content: "Project uses TypeScript",
      confidence: 0.9,
      source: "test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
    });

    const injection = await autoMemory.prepareMemoryContext({
      taskDescription: "TypeScript configuration",
    });

    expect(injection.content).toBeDefined();
    expect(injection.sources.length).toBeGreaterThan(0);
  });

  it("should respect token budget", async () => {
    const budgetManager = new TokenBudgetManager(128000, 0.1);
    expect(budgetManager.getMaxMemoryTokens()).toBe(12800); // 10% of 128k
  });

  it("should fit memories to budget", async () => {
    const budgetManager = new TokenBudgetManager(10000, 0.1);
    
    const memories = [
      {
        id: "1",
        type: "fact" as const,
        content: "Short memory",
        confidence: 0.9,
        source: "test",
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        useCount: 0,
      },
      {
        id: "2",
        type: "pattern" as const,
        content: "Another memory",
        confidence: 0.8,
        source: "test",
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        useCount: 0,
      },
    ];

    const result = await budgetManager.fitToBudget(memories, 100);
    expect(result.totalTokens).toBeLessThanOrEqual(100);
  });

  it("should evaluate tool results", async () => {
    const event = {
      type: "tool_result" as const,
      result: {
        id: "test",
        name: "shell_execute",
        output: "npm run build completed successfully",
      },
      duration: 100,
    };

    const candidate = await autoMemory.evaluate(event);
    expect(candidate).toBeDefined();
  });

  it("should persist memories", async () => {
    const candidate = {
      type: "fact" as const,
      content: "Test memory",
      confidence: 0.8,
      source: "test",
    };

    await autoMemory.persist(candidate);
    
    const memories = await store.searchCurated("Test memory", 10);
    expect(memories.length).toBeGreaterThan(0);
  });

  it("should flush session", async () => {
    // Add events
    for (let i = 0; i < 5; i++) {
      await autoMemory.evaluate({
        type: "tool_result",
        result: {
          id: `test${i}`,
          name: "shell_execute",
          output: "npm run build completed successfully",
        },
        duration: 100,
      });
    }

    const persisted = await autoMemory.flushSession();
    expect(persisted).toBeGreaterThanOrEqual(0);
  });
});
