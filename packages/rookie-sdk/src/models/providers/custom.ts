/**
 * Custom OpenAI-Compatible Provider
 *
 * For any OpenAI-compatible endpoint (LocalAI, vLLM, etc.)
 * ~25 lines of code thanks to Transport abstraction
 */

import {
  ModelProvider,
  ModelCapabilities,
  ChatParams,
  ChatWithToolsParams,
  ChatChunk,
  ChatResponse,
} from "../types.js";
import { Message } from "../../agent/types.js";
import { OpenAIChatCompletionsTransport } from "../transport/openai.js";

export interface CustomProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number;
  streaming?: boolean;
  functionCalling?: boolean;
}

export class CustomProvider implements ModelProvider {
  name: string;
  capabilities: ModelCapabilities;
  private config: Required<CustomProviderConfig>;
  private transport: OpenAIChatCompletionsTransport;

  constructor(config: CustomProviderConfig) {
    this.config = {
      maxTokens: 4096,
      streaming: true,
      functionCalling: true,
      ...config,
    };
    this.name = this.config.model;
    this.capabilities = {
      streaming: this.config.streaming,
      functionCalling: this.config.functionCalling,
      vision: false,
      maxTokens: this.config.maxTokens,
      contextWindow: 128000,
    };
    this.transport = new OpenAIChatCompletionsTransport(this.config.baseUrl);
  }

  async chat(messages: Message[]): Promise<ChatResponse> {
    const chunks: ChatChunk[] = [];
    for await (const chunk of this.chatStream({ messages })) {
      chunks.push(chunk);
    }
    return this.assembleResponse(chunks);
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    yield* this.doStreamRequest(params);
  }

  async *chatWithToolsStream(params: ChatWithToolsParams): AsyncGenerator<ChatChunk> {
    yield* this.doStreamRequest(params);
  }

  private async *doStreamRequest(
    params: ChatParams & Partial<ChatWithToolsParams>
  ): AsyncGenerator<ChatChunk> {
    const url = `${this.transport.baseUrl}/chat/completions`;

    const body = this.transport.getChatBody(params.messages, {
      model: this.config.model,
      temperature: params.temperature,
      maxTokens: params.maxTokens ?? this.config.maxTokens,
      stream: true,
      tools: params.tools,
      toolChoice: params.toolChoice,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: this.transport.getHeaders(this.config.apiKey),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Custom API error: ${await response.text()}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

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
            const parsed = JSON.parse(data);
            const chunk = this.transport.parseStreamChunk(parsed);

            if (chunk.content) {
              yield { type: "text", content: chunk.content };
            }
            if (chunk.toolCallDelta) {
              yield { type: "tool_call_delta", toolCall: chunk.toolCallDelta };
            }
            if (chunk.isDone || chunk.usage) {
              yield { type: "done", usage: chunk.usage };
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

    return { content, toolCalls: toolCalls.length ? toolCalls : undefined, usage };
  }
}
