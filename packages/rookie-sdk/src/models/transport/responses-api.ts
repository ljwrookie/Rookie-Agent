/**
 * OpenAI Responses API Transport
 *
 * OpenAI's newer Responses API (used by o1, o3 models)
 * Different from ChatCompletions - uses 'input' instead of 'messages'
 */

import { Message } from "../../agent/types.js";
import { ToolDefinition } from "../types.js";
import { BaseTransport } from "./base.js";

export class OpenAIResponsesTransport extends BaseTransport {
  readonly name = "openai-responses";
  readonly baseUrl: string;

  constructor(baseUrl = "https://api.openai.com/v1") {
    super();
    this.baseUrl = baseUrl;
  }

  formatMessages(messages: Message[]): unknown[] {
    // Responses API uses a different format
    return messages.map((m) => {
      if (m.role === "system") {
        return {
          role: "system",
          content: m.content,
        };
      }

      if (m.role === "tool") {
        return {
          type: "function_call_output",
          call_id: m.tool_call_id,
          output: m.content,
        };
      }

      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: "assistant",
          content: m.content,
          tool_calls: m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: typeof tc.params === "string" ? tc.params : JSON.stringify(tc.params),
            },
          })),
        };
      }

      return {
        role: m.role,
        content: m.content,
      };
    });
  }

  formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      type: "function",
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
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
    const r = response as ResponsesAPIResponse;

    let content = "";
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];

    for (const item of r.output || []) {
      if (item.type === "message" && item.content) {
        for (const c of item.content) {
          if (c.type === "output_text") {
            content += c.text || "";
          }
        }
      } else if (item.type === "function_call") {
        toolCalls.push({
          id: item.call_id || "",
          name: item.name || "",
          arguments: item.arguments || "",
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: r.usage ? {
        promptTokens: r.usage.input_tokens,
        completionTokens: r.usage.output_tokens,
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
    const c = chunk as ResponsesAPIStreamEvent;

    if (c.type === "response.completed" || c.type === "response.done") {
      return { isDone: true };
    }

    if (c.type === "response.output_item.added") {
      const item = c.item;
      if (item?.type === "function_call") {
        return {
          toolCall: {
            id: item.call_id || "",
            name: item.name || "",
            arguments: item.arguments || "",
          },
          isDone: false,
        };
      }
    }

    if (c.type === "response.output_text.delta") {
      return { content: c.delta || "", isDone: false };
    }

    if (c.type === "response.function_call_arguments.delta") {
      return {
        toolCallDelta: {
          id: c.item_id || "",
          name: "",
          arguments: c.delta || "",
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
    const body: Record<string, unknown> = {
      model: options.model,
      input: this.formatMessages(messages),
    };

    if (options.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options.maxTokens !== undefined) {
      body.max_output_tokens = options.maxTokens;
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

// Responses API Types
interface ResponsesAPIResponse {
  output?: Array<
    | {
        type: "message";
        content?: Array<{ type: "output_text"; text?: string }>;
      }
    | {
        type: "function_call";
        call_id?: string;
        name?: string;
        arguments?: string;
      }
  >;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
}

interface ResponsesAPIStreamEvent {
  type: string;
  delta?: string;
  item?: {
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  item_id?: string;
}
