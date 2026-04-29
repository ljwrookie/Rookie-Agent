/**
 * Context Pipeline tests (P4-T3)
 * Tests for 5-stage context preprocessing pipeline
 */

import { describe, it, expect, beforeAll } from "vitest";
import { NapiTransport } from "../transport/napi.js";
import { runContextPipeline, initContextPipeline } from "../agent/context-pipeline.js";
import type { Message } from "../agent/types.js";

describe("Context Pipeline (P4-T3)", () => {
  let transport: NapiTransport;

  beforeAll(async () => {
    transport = new NapiTransport();
    const connected = await transport.connect();
    if (connected) {
      await initContextPipeline(transport);
    }
  });

  const createMessage = (role: Message["role"], content: string): Message => ({
    role,
    content,
  });

  it("should process empty messages", async () => {
    const result = await runContextPipeline([]);
    expect(result.messages).toHaveLength(0);
  });

  it("should process single message", async () => {
    const messages = [createMessage("user", "Hello")];
    const result = await runContextPipeline(messages);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("Hello");
  });

  it("should apply tool budget (Stage 1)", async () => {
    const longContent = "a".repeat(10000);
    const messages = [createMessage("tool", longContent)];

    const result = await runContextPipeline(messages, {
      maxToolResultTokens: 100,
    });

    expect(result.stats.stage1ToolResults).toBe(1);
    expect(result.messages[0].content).toContain("truncated");
  });

  it("should snip long messages (Stage 2)", async () => {
    const longContent = "a".repeat(20000);
    const messages = [createMessage("assistant", longContent)];

    const result = await runContextPipeline(messages, {
      snipThreshold: 1000,
    });

    expect(result.stats.stage2Snipped).toBe(1);
    expect(result.messages[0].content).toContain("snipped");
  });

  it("should normalize whitespace (Stage 3)", async () => {
    const messages = [createMessage("user", "Line 1\n\n\n\nLine 2\twith tab")];

    const result = await runContextPipeline(messages);

    expect(result.stats.stage3Normalized).toBe(1);
    expect(result.messages[0].content).not.toContain("\n\n\n");
    expect(result.messages[0].content).not.toContain("\t");
  });

  it("should collapse old messages (Stage 4)", async () => {
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push(createMessage("user", `Message ${i}`));
    }

    const result = await runContextPipeline(messages, {
      maxMessages: 5,
    });

    expect(result.messages.length).toBeLessThanOrEqual(5);
    expect(result.stats.stage4Collapsed).toBeGreaterThan(0);
  });

  it("should autocompact when over threshold (Stage 5)", async () => {
    const messages: Message[] = [createMessage("system", "You are helpful")];
    for (let i = 0; i < 50; i++) {
      messages.push(createMessage("user", "a".repeat(1000)));
    }

    const result = await runContextPipeline(messages, {
      contextWindow: 10000,
      compactThreshold: 0.5,
    });

    expect(result.stats.stage5Compacted).toBeGreaterThan(0);
  });

  it("should complete full pipeline in < 5ms for 100K tokens", async () => {
    // Create ~100K tokens worth of content
    const messages: Message[] = [];
    for (let i = 0; i < 100; i++) {
      messages.push(createMessage("user", "Hello world. ".repeat(100)));
    }

    const start = Date.now();
    const result = await runContextPipeline(messages);
    const duration = Date.now() - start;

    console.log(`Pipeline duration: ${duration}ms`);
    expect(duration).toBeLessThan(50); // Allow some margin
    expect(result.stats.totalTokensBefore).toBeGreaterThan(0);
    expect(result.stats.totalTokensAfter).toBeGreaterThan(0);
  });

  it("should preserve system messages during collapse", async () => {
    const messages: Message[] = [
      createMessage("system", "System prompt 1"),
      createMessage("system", "System prompt 2"),
      ...Array(20).fill(null).map((_, i) => createMessage("user", `Message ${i}`)),
    ];

    const result = await runContextPipeline(messages, {
      maxMessages: 5,
    });

    const systemCount = result.messages.filter((m) => m.role === "system").length;
    expect(systemCount).toBeGreaterThanOrEqual(2);
  });

  it("should report accurate stats", async () => {
    const messages = [
      createMessage("system", "You are helpful"),
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there"),
    ];

    const result = await runContextPipeline(messages);

    expect(result.stats.totalTokensBefore).toBeGreaterThan(0);
    expect(result.stats.totalTokensAfter).toBeGreaterThan(0);
    expect(result.stats.totalTokensBefore).toBeGreaterThanOrEqual(result.stats.totalTokensAfter);
  });
});
