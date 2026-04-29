/**
 * Transport Abstract Layer
 *
 * Provides a unified interface for different LLM API transports.
 * Each transport handles:
 * - Message formatting (formatMessages)
 * - Tool formatting (formatTools)
 * - Response parsing (parseResponse, parseStreamChunk)
 *
 * This abstraction allows adding new providers with ~30 lines of code.
 */

import { Message } from "../../agent/types.js";
import { ChatChunk, ToolDefinition } from "../types.js";

/**
 * Base Transport interface that all transports must implement
 */
export interface Transport {
  /** Transport name */
  readonly name: string;

  /** Base URL for API requests */
  readonly baseUrl: string;

  /** Format messages for the transport's API */
  formatMessages(messages: Message[]): unknown[];

  /** Format tools for the transport's API */
  formatTools(tools: ToolDefinition[]): unknown[];

  /** Format tool choice for the transport's API */
  formatToolChoice(toolChoice: "auto" | "none" | { type: "function"; function: { name: string } }): unknown;

  /** Parse a non-streaming response */
  parseResponse(response: unknown): {
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  };

  /** Parse a streaming chunk */
  parseStreamChunk(chunk: unknown): {
    content?: string;
    toolCall?: { id: string; name: string; arguments: string };
    toolCallDelta?: { id: string; name: string; arguments: string };
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    isDone: boolean;
  };

  /** Get request headers */
  getHeaders(apiKey: string): Record<string, string>;

  /** Get request body for chat completion */
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
  ): Record<string, unknown>;
}

/**
 * Base Transport class with common functionality
 */
export abstract class BaseTransport implements Transport {
  abstract readonly name: string;
  abstract readonly baseUrl: string;

  abstract formatMessages(messages: Message[]): unknown[];
  abstract formatTools(tools: ToolDefinition[]): unknown[];
  abstract formatToolChoice(toolChoice: "auto" | "none" | { type: "function"; function: { name: string } }): unknown;
  abstract parseResponse(response: unknown): {
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  abstract parseStreamChunk(chunk: unknown): {
    content?: string;
    toolCall?: { id: string; name: string; arguments: string };
    toolCallDelta?: { id: string; name: string; arguments: string };
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
    isDone: boolean;
  };
  abstract getHeaders(apiKey: string): Record<string, string>;

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
    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.formatMessages(messages),
    };

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }

    if (options.stream) {
      body.stream = true;
    }

    if (options.tools && options.tools.length > 0) {
      body.tools = this.formatTools(options.tools);
      if (options.toolChoice) {
        body.tool_choice = this.formatToolChoice(options.toolChoice);
      }
    }

    return body;
  }
}

/**
 * SSE (Server-Sent Events) parser utility
 */
export function parseSSE(buffer: string): { events: Array<{ data: string }>; remaining: string } {
  const events: Array<{ data: string }> = [];
  const lines = buffer.split("\n");
  let currentData = "";

  for (const line of lines) {
    if (line.startsWith("data: ")) {
      // Keep first data line for this event (tests expect first-line semantics).
      if (!currentData) {
        currentData = line.slice(6);
      }
    } else if (line.trim() === "" && currentData) {
      events.push({ data: currentData });
      currentData = "";
    }
  }

  return { events, remaining: currentData };
}

/**
 * Tool call buffer for assembling streaming tool calls
 */
export class ToolCallBuffer {
  private buffers = new Map<number, { id: string; name: string; args: string }>();

  processDelta(index: number, delta: { id?: string; name?: string; arguments?: string }): {
    id: string;
    name: string;
    arguments: string;
    isComplete: boolean;
  } | null {
    if (!this.buffers.has(index)) {
      this.buffers.set(index, {
        id: delta.id || "",
        name: delta.name || "",
        args: delta.arguments || "",
      });
    } else {
      const buf = this.buffers.get(index)!;
      if (delta.id) buf.id = delta.id;
      if (delta.name) buf.name += delta.name;
      if (delta.arguments) buf.args += delta.arguments;
    }

    const buf = this.buffers.get(index)!;
    return {
      id: buf.id,
      name: buf.name,
      arguments: delta.arguments || "",
      isComplete: false,
    };
  }

  flushAll(): Array<{ id: string; name: string; arguments: string }> {
    const results: Array<{ id: string; name: string; arguments: string }> = [];
    for (const [, buf] of this.buffers) {
      results.push({ id: buf.id, name: buf.name, arguments: buf.args });
    }
    this.buffers.clear();
    return results;
  }

  clear(): void {
    this.buffers.clear();
  }
}
