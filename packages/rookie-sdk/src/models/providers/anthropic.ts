import {
  ModelProvider,
  ModelCapabilities,
  ChatParams,
  ChatWithToolsParams,
  ChatChunk,
  ChatResponse,
} from "../types.js";
import { Message } from "../../agent/types.js";

export interface AnthropicConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicProvider implements ModelProvider {
  name: string;
  capabilities: ModelCapabilities;
  private config: Required<Pick<AnthropicConfig, "apiKey" | "model">> & AnthropicConfig;

  constructor(config: AnthropicConfig) {
    this.config = {
      model: "claude-sonnet-4-20250514",
      maxTokens: 8192,
      ...config,
    };
    this.name = this.config.model;
    this.capabilities = {
      streaming: true,
      functionCalling: true,
      vision: true,
      maxTokens: this.config.maxTokens ?? 8192,
      contextWindow: 200000,
    };
  }

  // ── Non-streaming convenience ────────────────────────────────

  async chat(messages: Message[]): Promise<ChatResponse> {
    const chunks: ChatChunk[] = [];
    for await (const chunk of this.chatStream({ messages })) {
      chunks.push(chunk);
    }
    return this.assembleResponse(chunks);
  }

  // ── Streaming chat ───────────────────────────────────────────

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    yield* this.doStreamRequest(params);
  }

  // ── Streaming chat with tools ────────────────────────────────

  async *chatWithToolsStream(params: ChatWithToolsParams): AsyncGenerator<ChatChunk> {
    yield* this.doStreamRequest(params);
  }

  // ── Internal ─────────────────────────────────────────────────

  private async *doStreamRequest(
    params: ChatParams & Partial<ChatWithToolsParams>
  ): AsyncGenerator<ChatChunk> {
    const url = `${this.config.baseUrl || "https://api.anthropic.com"}/v1/messages`;

    // Separate system message from the rest
    const systemMessages = params.messages.filter((m) => m.role === "system");
    const nonSystemMessages = params.messages.filter((m) => m.role !== "system");

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: params.maxTokens ?? this.config.maxTokens ?? 8192,
      messages: this.formatMessages(nonSystemMessages),
      stream: true,
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join("\n\n");
    }

    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
      if (params.toolChoice) {
        if (params.toolChoice === "auto") {
          body.tool_choice = { type: "auto" };
        } else if (params.toolChoice === "none") {
          // Anthropic doesn't have "none" — just omit tools
        } else if (typeof params.toolChoice === "object" && "type" in params.toolChoice) {
          body.tool_choice = { type: "tool", name: params.toolChoice.function.name };
        }
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming request");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Track current tool use block
    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";
    let inToolUse = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;

            switch (event.type) {
              case "content_block_start": {
                const block = event.content_block;
                if (block?.type === "tool_use") {
                  inToolUse = true;
                  currentToolId = block.id || "";
                  currentToolName = block.name || "";
                  currentToolArgs = "";
                }
                break;
              }

              case "content_block_delta": {
                const delta = event.delta;
                if (delta?.type === "text_delta" && delta.text) {
                  yield { type: "text", content: delta.text };
                }
                if (delta?.type === "input_json_delta" && delta.partial_json) {
                  currentToolArgs += delta.partial_json;
                  yield {
                    type: "tool_call_delta",
                    toolCall: {
                      id: currentToolId,
                      name: currentToolName,
                      arguments: delta.partial_json,
                    },
                  };
                }
                break;
              }

              case "content_block_stop": {
                if (inToolUse) {
                  yield {
                    type: "tool_call",
                    toolCall: {
                      id: currentToolId,
                      name: currentToolName,
                      arguments: currentToolArgs,
                    },
                  };
                  inToolUse = false;
                  currentToolId = "";
                  currentToolName = "";
                  currentToolArgs = "";
                }
                break;
              }

              case "message_delta": {
                if (event.usage) {
                  yield {
                    type: "done",
                    usage: {
                      promptTokens: 0, // Anthropic gives input_tokens on message_start
                      completionTokens: event.usage.output_tokens || 0,
                      totalTokens: 0,
                    },
                  };
                }
                break;
              }

              case "message_start": {
                // Capture input token usage
                if (event.message?.usage) {
                  // We'll report this in the final "done" chunk
                }
                break;
              }
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private formatMessages(messages: Message[]): Record<string, unknown>[] {
    return messages.map((m) => {
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
            input: typeof tc.params === "string" ? JSON.parse(tc.params as string) : tc.params,
          });
        }
        return { role: "assistant", content: contentBlocks };
      }

      return { role: m.role, content: m.content };
    });
  }

  private assembleResponse(chunks: ChatChunk[]): ChatResponse {
    let content = "";
    const toolCalls: Array<{ id: string; name: string; arguments: string }> = [];
    let usage: { prompt: number; completion: number } | undefined;

    for (const chunk of chunks) {
      if (chunk.type === "text" && chunk.content) {
        content += chunk.content;
      }
      if (chunk.type === "tool_call" && chunk.toolCall) {
        toolCalls.push(chunk.toolCall);
      }
      if (chunk.type === "done" && chunk.usage) {
        usage = {
          prompt: chunk.usage.promptTokens,
          completion: chunk.usage.completionTokens,
        };
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }
}

// ── Anthropic SSE Types ──────────────────────────────────────────

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
  message?: {
    usage?: { input_tokens: number; output_tokens: number };
  };
  usage?: {
    output_tokens?: number;
  };
}
