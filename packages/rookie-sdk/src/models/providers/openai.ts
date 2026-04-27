import {
  ModelProvider,
  ModelCapabilities,
  ChatParams,
  ChatWithToolsParams,
  ChatChunk,
  ChatResponse,
} from "../types.js";
import { Message } from "../../agent/types.js";

export interface OpenAIConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export class OpenAIProvider implements ModelProvider {
  name: string;
  capabilities: ModelCapabilities;
  private config: Required<Pick<OpenAIConfig, "apiKey" | "model">> & OpenAIConfig;

  constructor(config: OpenAIConfig) {
    this.config = {
      model: "gpt-4o-mini",
      temperature: 0.7,
      ...config,
    };
    this.name = this.config.model;
    this.capabilities = {
      streaming: true,
      functionCalling: true,
      vision: this.config.model.includes("gpt-4") || this.config.model.includes("o"),
      maxTokens: 16384,
      contextWindow: 128000,
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

  // ── Embedding ────────────────────────────────────────────────

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.config.baseUrl || "https://api.openai.com/v1"}/embeddings`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI Embedding API error: ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data.map((d) => d.embedding);
  }

  // ── Internal ─────────────────────────────────────────────────

  private async *doStreamRequest(
    params: ChatParams & Partial<ChatWithToolsParams>
  ): AsyncGenerator<ChatChunk> {
    const url = `${this.config.baseUrl || "https://api.openai.com/v1"}/chat/completions`;

    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: this.formatMessages(params.messages),
      temperature: params.temperature ?? this.config.temperature,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (params.maxTokens || this.config.maxTokens) {
      body.max_tokens = params.maxTokens ?? this.config.maxTokens;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools;
      if (params.toolChoice) {
        body.tool_choice = params.toolChoice;
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    if (!response.body) {
      throw new Error("No response body for streaming request");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Track tool call assembly across deltas
    const toolCallBuffers = new Map<number, { id: string; name: string; args: string }>();

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
          if (data === "[DONE]") {
            // Flush any remaining tool calls
            for (const [, tc] of toolCallBuffers) {
              yield {
                type: "tool_call",
                toolCall: { id: tc.id, name: tc.name, arguments: tc.args },
              };
            }
            toolCallBuffers.clear();
            continue;
          }

          try {
            const parsed = JSON.parse(data) as OpenAIStreamChunk;
            const delta = parsed.choices?.[0]?.delta;

            if (!delta) {
              // Usage-only chunk (at the end)
              if (parsed.usage) {
                yield {
                  type: "done",
                  usage: {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  },
                };
              }
              continue;
            }

            // Text content
            if (delta.content) {
              yield { type: "text", content: delta.content };
            }

            // Tool call deltas
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index;
                if (!toolCallBuffers.has(idx)) {
                  toolCallBuffers.set(idx, {
                    id: tc.id || "",
                    name: tc.function?.name || "",
                    args: tc.function?.arguments || "",
                  });
                } else {
                  const buf = toolCallBuffers.get(idx)!;
                  if (tc.id) buf.id = tc.id;
                  if (tc.function?.name) buf.name += tc.function.name;
                  if (tc.function?.arguments) buf.args += tc.function.arguments;
                }

                yield {
                  type: "tool_call_delta",
                  toolCall: {
                    id: toolCallBuffers.get(idx)!.id,
                    name: toolCallBuffers.get(idx)!.name,
                    arguments: tc.function?.arguments || "",
                  },
                };
              }
            }

            // Finish reason
            if (parsed.choices?.[0]?.finish_reason) {
              const reason = parsed.choices[0].finish_reason;
              if (reason === "tool_calls") {
                // Flush tool calls
                for (const [, tc] of toolCallBuffers) {
                  yield {
                    type: "tool_call",
                    toolCall: { id: tc.id, name: tc.name, arguments: tc.args },
                  };
                }
                toolCallBuffers.clear();
              }
              if (parsed.usage) {
                yield {
                  type: "done",
                  usage: {
                    promptTokens: parsed.usage.prompt_tokens,
                    completionTokens: parsed.usage.completion_tokens,
                    totalTokens: parsed.usage.total_tokens,
                  },
                };
              }
            }
          } catch {
            // Ignore malformed JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private formatMessages(messages: Message[]): Record<string, unknown>[] {
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

// ── OpenAI SSE Types ─────────────────────────────────────────────

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
