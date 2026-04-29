/**
 * Anthropic Messages Transport
 *
 * Anthropic's Messages API format used by:
 * - Claude 3 (Opus, Sonnet, Haiku)
 * - Claude 2
 */

import { Message } from "../../agent/types.js";
import { ToolDefinition } from "../types.js";
import { BaseTransport } from "./base.js";

export class AnthropicMessagesTransport extends BaseTransport {
  readonly name = "anthropic-messages";
  readonly baseUrl: string;

  constructor(baseUrl = "https://api.anthropic.com") {
    super();
    this.baseUrl = baseUrl;
  }

  formatMessages(messages: Message[]): unknown[] {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        // Handle tool result messages
        if (m.role === "tool") {
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: m.tool_call_id,
                content: m.content,
              },
            ],
          };
        }

        // Handle assistant messages with tool calls
        if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          const contentBlocks: unknown[] = [];
          if (m.content) {
            contentBlocks.push({ type: "text", text: m.content });
          }
          for (const tc of m.toolCalls) {
            contentBlocks.push({
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: typeof tc.params === "string" ? JSON.parse(tc.params) : tc.params,
            });
          }
          return { role: "assistant", content: contentBlocks };
        }

        // Regular messages
        return {
          role: m.role,
          content: m.content,
        };
      });
  }

  formatSystemMessage(messages: Message[]): string | undefined {
    const systemMessages = messages.filter((m) => m.role === "system");
    if (systemMessages.length === 0) return undefined;
    return systemMessages.map((m) => m.content).join("\n\n");
  }

  formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }

  formatToolChoice(toolChoice: "auto" | "none" | { type: "function"; function: { name: string } }): unknown {
    if (toolChoice === "auto") {
      return { type: "auto" };
    }
    if (toolChoice === "none") {
      return undefined; // Anthropic doesn't have "none", just omit tools
    }
    if (typeof toolChoice === "object" && "type" in toolChoice) {
      return { type: "tool", name: toolChoice.function.name };
    }
    return undefined;
  }

  parseResponse(response: unknown): {
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  } {
    const r = response as AnthropicResponse;

    let content = "";
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for (const block of r.content || []) {
      if (block.type === "text") {
        content += block.text || "";
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id || "",
          name: block.name || "",
          arguments: JSON.stringify(block.input || {}),
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: r.usage ? {
        promptTokens: r.usage.input_tokens,
        completionTokens: r.usage.output_tokens,
        totalTokens: r.usage.input_tokens + r.usage.output_tokens,
      } : undefined,
    };
  }

  parseStreamChunk(chunk: unknown): {
    content?: string;
    toolCall?: { id: string; name: string; arguments: string };
    toolCallDelta?: { id: string; name: string; arguments: string };
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    isDone: boolean;
  } {
    const event = chunk as AnthropicStreamEvent;

    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        if (block?.type === "tool_use") {
          return {
            toolCall: {
              id: block.id || "",
              name: block.name || "",
              arguments: "",
            },
            isDone: false,
          };
        }
        return { isDone: false };
      }

      case "content_block_delta": {
        const delta = event.delta;
        if (delta?.type === "text_delta" && delta.text) {
          return { content: delta.text, isDone: false };
        }
        if (delta?.type === "input_json_delta" && delta.partial_json) {
          return {
            toolCallDelta: {
              id: "", // Will be filled by buffer
              name: "",
              arguments: delta.partial_json,
            },
            isDone: false,
          };
        }
        return { isDone: false };
      }

      case "message_delta": {
        if (event.usage) {
          return {
            usage: {
              promptTokens: 0, // Anthropic gives input tokens on message_start
              completionTokens: event.usage.output_tokens || 0,
              totalTokens: event.usage.output_tokens || 0,
            },
            isDone: true,
          };
        }
        return { isDone: true };
      }

      case "message_stop": {
        return { isDone: true };
      }

      default:
        return { isDone: false };
    }
  }

  getHeaders(apiKey: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  getChatBody(
    messages: Message[],
    options: {
      model: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      tools?: ToolDefinition[];
      toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
    }
  ): Record<string, unknown> {
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    const systemPrompt = this.formatSystemMessage(messages);

    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens || 4096,
      messages: this.formatMessages(nonSystemMessages),
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.stream) {
      body.stream = true;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
      const formattedToolChoice = this.formatToolChoice(options.toolChoice || "auto");
      if (formattedToolChoice) {
        body.tool_choice = formattedToolChoice;
      }
    }

    return body;
  }
}

// Anthropic API Types
interface AnthropicResponse {
  content?: Array<
    | { type: "text"; text?: string }
    | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  >;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  usage?: {
    output_tokens?: number;
  };
}
