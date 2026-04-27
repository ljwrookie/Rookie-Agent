import {
  ModelProvider,
  ModelCapabilities,
  ChatParams,
  ChatWithToolsParams,
  ChatChunk,
  ChatResponse,
} from "../types.js";

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  siteUrl?: string;
  siteName?: string;
}

/**
 * OpenRouterProvider: access 200+ models through a single API.
 * Uses OpenAI-compatible chat/completions endpoint with streaming.
 */
export class OpenRouterProvider implements ModelProvider {
  name = "openrouter";
  capabilities: ModelCapabilities;

  private config: OpenRouterConfig;
  private baseUrl: string;
  private model: string;

  constructor(config: OpenRouterConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl || "https://openrouter.ai/api/v1";
    this.model = config.model || "anthropic/claude-sonnet-4-20250514";
    this.capabilities = {
      streaming: true,
      functionCalling: true,
      vision: true,
      maxTokens: 8192,
      contextWindow: 200000,
    };
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    yield* this.requestStream(params.messages, undefined);
  }

  async *chatWithToolsStream(params: ChatWithToolsParams): AsyncGenerator<ChatChunk> {
    // ToolDefinition already has { type: "function", function: { ... } } shape
    yield* this.requestStream(params.messages, params.tools);
  }

  async chat(messages: Array<{ role: string; content: string }>): Promise<ChatResponse> {
    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenRouter error ${resp.status}: ${err}`);
    }

    const data = (await resp.json()) as any;
    const choice = data.choices?.[0];

    return {
      content: choice?.message?.content || "",
      toolCalls: (choice?.message?.tool_calls || []).map((tc: any) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
      usage: data.usage
        ? { prompt: data.usage.prompt_tokens, completion: data.usage.completion_tokens }
        : undefined,
    };
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  // ── Internal ──────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.config.apiKey}`,
      "HTTP-Referer": this.config.siteUrl || "https://github.com/rookie-agent",
      "X-Title": this.config.siteName || "Rookie Agent",
    };
  }

  private async *requestStream(
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[]
  ): AsyncGenerator<ChatChunk> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`OpenRouter error ${resp.status}: ${err}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";
    const toolCallAcc = new Map<number, { id: string; name: string; arguments: string }>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        let chunk: any;
        try { chunk = JSON.parse(payload); } catch { continue; }

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) {
          if (chunk.usage) {
            yield {
              type: "done",
              usage: {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
                totalTokens: chunk.usage.total_tokens,
              },
            };
          }
          continue;
        }

        if (delta.content) {
          yield { type: "text", content: delta.content };
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAcc.has(idx)) {
              toolCallAcc.set(idx, { id: tc.id || "", name: "", arguments: "" });
            }
            const acc = toolCallAcc.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;

            yield {
              type: "tool_call_delta",
              toolCall: { id: acc.id, name: acc.name, arguments: tc.function?.arguments || "" },
            };
          }
        }

        if (chunk.choices?.[0]?.finish_reason === "tool_calls") {
          for (const [, acc] of toolCallAcc) {
            yield { type: "tool_call", toolCall: acc };
          }
          toolCallAcc.clear();
        }
      }
    }
  }
}
