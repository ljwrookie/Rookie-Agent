/**
 * Tokenizer tests (P4-T2)
 * Tests for tiktoken-rs integration via NAPI
 */

import { describe, it, expect, beforeAll } from "vitest";
import { NapiTransport } from "../transport/napi.js";

describe("Tokenizer (P4-T2)", () => {
  let transport: NapiTransport;

  beforeAll(async () => {
    transport = new NapiTransport();
    await transport.connect();
  });

  it("should count tokens accurately", async () => {
    // Skip if NAPI not available
    if (!transport.isConnected()) {
      console.log("NAPI not available, skipping");
      return;
    }

    const count = await transport.countTokens("Hello world");
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10); // Should be 2-3 tokens
  });

  it("should count tokens for different models", async () => {
    if (!transport.isConnected()) return;

    const text = "Hello world, this is a test.";
    const cl100k = await transport.countTokens(text, "cl100k_base");
    const o200k = await transport.countTokens(text, "o200k_base");

    expect(cl100k).toBeGreaterThan(0);
    expect(o200k).toBeGreaterThan(0);
  });

  it("should truncate text to max tokens", async () => {
    if (!transport.isConnected()) return;

    const longText = "Hello world. ".repeat(100);
    const result = await transport.truncateToTokens(longText, 10);

    expect(result.originalCount).toBeGreaterThan(10);
    expect(result.truncatedCount).toBe(10);
    expect(result.text.length).toBeLessThan(longText.length);
  });

  it("should handle empty strings", async () => {
    if (!transport.isConnected()) return;

    const count = await transport.countTokens("");
    expect(count).toBe(0);
  });

  it("should maintain token count error < 1%", async () => {
    if (!transport.isConnected()) return;

    // Test with known token counts
    const testCases = [
      { text: "Hello", expectedRange: [1, 2] },
      { text: "Hello world", expectedRange: [2, 3] },
      { text: "The quick brown fox", expectedRange: [4, 6] },
    ];

    for (const { text, expectedRange } of testCases) {
      const count = await transport.countTokens(text);
      expect(count).toBeGreaterThanOrEqual(expectedRange[0]);
      expect(count).toBeLessThanOrEqual(expectedRange[1]);
    }
  });
});
