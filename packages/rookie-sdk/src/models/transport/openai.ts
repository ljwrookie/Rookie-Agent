/**
 * OpenAI ChatCompletions Transport
 *
 * Standard OpenAI API format used by:
 * - OpenAI (GPT-4, GPT-3.5)
 * - Azure OpenAI
 * - Any OpenAI-compatible endpoint
 */

import { Message } from "../../agent/types.js";
import { ToolDefinition } from "../types.js";
import { BaseTransport, parseSSE, ToolCallBuffer } from "./base.js";

export class OpenAIChatCompletionsTransport extends BaseTransport {
  readonly name: string = "openai-chat-completions";
  readonly baseUrl: string;

  constructor(baseUrl = "https://api.openai.com/v1") {
    super();
    this.baseUrl = baseUrl;
  }

  formatMessages(messages: Message[]): unknown[] {
    return messages.map((m) => {
      const msg: Record<string, unknown> = {
        role: m.role,
        content: m.content,
      };

      if (m.tool_call_id) {
        msg.tool_call_id = m.tool_call_id;
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments: typeof tc.params === "string" ? tc.params : JSON.stringify(tc.params),
          },
        }));
      }

      return msg;
    });
  }

  formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      },
    }));
  }

  formatToolChoice(toolChoice: "auto" | "none" | { type: "function"; function: { name: string } }): unknown {
    return toolChoice;
  }

  parseResponse(response: unknown): {
    content: string;
    toolCalls?: Array<{ id: string; name: string; arguments: string }>;
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  } {
    const r = response as OpenAIResponse;
    const choice = r.choices?.[0];

    const content = choice?.message?.content || "";
    const toolCalls = choice?.message?.tool_calls?.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content,
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: r.usage ? {
        promptTokens: r.usage.prompt_tokens,
        completionTokens: r.usage.completion_tokens,
        totalTokens: r.usage.total_tokens,
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
    const c = chunk as OpenAIStreamChunk;

    // Check for done signal
    if (c.choices?.[0]?.finish_reason) {
      return { isDone: true };
    }

    // Check for usage
    if (c.usage) {
      return {
        usage: {
          promptTokens: c.usage.prompt_tokens,
          completionTokens: c.usage.completion_tokens,
          totalTokens: c.usage.total_tokens,
        },
        isDone: true,
      };
    }

    const delta = c.choices?.[0]?.delta;
    if (!delta) {
      return { isDone: false };
    }

    // Text content
    if (delta.content) {
      return { content: delta.content, isDone: false };
    }

    // Tool call delta
    if (delta.tool_calls && delta.tool_calls.length > 0) {
      const tc = delta.tool_calls[0];
      return {
        toolCallDelta: {
          id: tc.id || "",
          name: tc.function?.name || "",
          arguments: tc.function?.arguments || "",
        },
        isDone: false,
      };
    }

    return { isDone: false };
  }

  getHeaders(apiKey: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
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
    const body = super.getChatBody(messages, options);

    // Add stream options for usage
    if (options.stream) {
      body.stream_options = { include_usage: true };
    }

    return body;
  }
}

// OpenAI API Types
interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChunk {
  choices?: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export { parseSSE, ToolCallBuffer };
