import { describe, it, expect } from "vitest";
import {
  OpenAIChatCompletionsTransport,
  AnthropicMessagesTransport,
  OpenRouterTransport,
  OpenAIResponsesTransport,
  parseSSE,
  ToolCallBuffer,
} from "../src/models/transport/index.js";
import type { Message } from "../src/agent/types.js";

describe("OpenAIChatCompletionsTransport", () => {
  const transport = new OpenAIChatCompletionsTransport();

  it("should format messages correctly", () => {
    const messages: Message[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
    ];

    const formatted = transport.formatMessages(messages);
    expect(formatted).toHaveLength(2);
    expect(formatted[0]).toEqual({ role: "system", content: "You are helpful" });
    expect(formatted[1]).toEqual({ role: "user", content: "Hello" });
  });

  it("should format tools correctly", () => {
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "test",
          description: "Test function",
          parameters: { type: "object", properties: {} },
        },
      },
    ];

    const formatted = transport.formatTools(tools);
    expect(formatted).toHaveLength(1);
    expect(formatted[0]).toMatchObject({
      type: "function",
      function: {
        name: "test",
        description: "Test function",
      },
    });
  });

  it("should get correct headers", () => {
    const headers = transport.getHeaders("test-api-key");
    expect(headers["Authorization"]).toBe("Bearer test-api-key");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("should build chat body with all options", () => {
    const messages: Message[] = [{ role: "user", content: "Hello" }];
    const body = transport.getChatBody(messages, {
      model: "gpt-4",
      temperature: 0.5,
      maxTokens: 100,
      stream: true,
    });

    expect(body.model).toBe("gpt-4");
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
    expect(body.stream).toBe(true);
    expect(body.messages).toHaveLength(1);
  });
});

describe("AnthropicMessagesTransport", () => {
  const transport = new AnthropicMessagesTransport();

  it("should format messages excluding system", () => {
    const messages: Message[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
    ];

    const formatted = transport.formatMessages(messages);
    expect(formatted).toHaveLength(1);
    expect(formatted[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("should extract system message", () => {
    const messages: Message[] = [
      { role: "system", content: "System prompt" },
      { role: "user", content: "Hello" },
    ];

    const system = transport.formatSystemMessage(messages);
    expect(system).toBe("System prompt");
  });

  it("should format tools for Anthropic API", () => {
    const tools = [
      {
        type: "function" as const,
        function: {
          name: "test",
          description: "Test function",
          parameters: { type: "object" },
        },
      },
    ];

    const formatted = transport.formatTools(tools);
    expect(formatted[0]).toMatchObject({
      name: "test",
      description: "Test function",
      input_schema: { type: "object" },
    });
  });

  it("should get correct headers", () => {
    const headers = transport.getHeaders("test-api-key");
    expect(headers["x-api-key"]).toBe("test-api-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });
});

describe("OpenRouterTransport", () => {
  const transport = new OpenRouterTransport({
    apiKey: "test-key",
    siteUrl: "https://test.com",
    siteName: "Test App",
  });

  it("should get OpenRouter-specific headers", () => {
    const headers = transport.getHeaders("test-key");
    expect(headers["HTTP-Referer"]).toBe("https://test.com");
    expect(headers["X-Title"]).toBe("Test App");
  });

  it("should add transforms to body", () => {
    const messages: Message[] = [{ role: "user", content: "Hello" }];
    const body = transport.getChatBody(messages, { model: "test" });
    expect(body.transforms).toEqual(["middle-out"]);
  });
});

describe("OpenAIResponsesTransport", () => {
  const transport = new OpenAIResponsesTransport();

  it("should format messages for Responses API", () => {
    const messages: Message[] = [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
    ];

    const formatted = transport.formatMessages(messages);
    expect(formatted).toHaveLength(2);
  });

  it("should build chat body with input field", () => {
    const messages: Message[] = [{ role: "user", content: "Hello" }];
    const body = transport.getChatBody(messages, {
      model: "o1",
      maxTokens: 100,
    });

    expect(body.model).toBe("o1");
    expect(body.input).toBeDefined();
    expect(body.max_output_tokens).toBe(100);
  });
});

describe("parseSSE", () => {
  it("should parse SSE data lines", () => {
    const buffer = "data: hello\ndata: world\n\n";
    const result = parseSSE(buffer);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].data).toBe("hello");
  });

  it("should handle partial data", () => {
    const buffer = "data: partial";
    const result = parseSSE(buffer);

    expect(result.events).toHaveLength(0);
    expect(result.remaining).toBe("partial");
  });
});

describe("ToolCallBuffer", () => {
  it("should accumulate tool call deltas", () => {
    const buffer = new ToolCallBuffer();

    buffer.processDelta(0, { id: "call_1", name: "test", arguments: "{" });
    buffer.processDelta(0, { arguments: "\"arg\":1}" });

    const flushed = buffer.flushAll();
    expect(flushed).toHaveLength(1);
    expect(flushed[0].id).toBe("call_1");
    expect(flushed[0].name).toBe("test");
  });

  it("should handle multiple tool calls", () => {
    const buffer = new ToolCallBuffer();

    buffer.processDelta(0, { id: "call_1", name: "func1", arguments: "{}" });
    buffer.processDelta(1, { id: "call_2", name: "func2", arguments: "{}" });

    const flushed = buffer.flushAll();
    expect(flushed).toHaveLength(2);
  });
});
