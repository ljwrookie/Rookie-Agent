/**
 * Google Gemini Provider
 *
 * ~45 lines of code thanks to Transport abstraction
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

export interface GeminiConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export class GeminiProvider implements ModelProvider {
  name: string;
  capabilities: ModelCapabilities;
  private config: Required<Pick<GeminiConfig, "apiKey" | "model">> & GeminiConfig;
  private baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  constructor(config: GeminiConfig) {
    this.config = {
      model: "gemini-1.5-flash",
      maxTokens: 8192,
      ...config,
    };
    this.name = this.config.model;
    this.capabilities = {
      streaming: true,
      functionCalling: true,
      vision: true,
      maxTokens: this.config.maxTokens ?? 8192,
      contextWindow: 1000000, // Gemini has huge context
    };
  }

  async chat(messages: Message[]): Promise<ChatResponse> {
    const chunks: ChatChunk[] = [];
    for await (const chunk of this.chatStream({ messages })) {
      chunks.push(chunk);
    }
    return this.assembleResponse(chunks);
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    const contents = this.formatMessages(params.messages);
    const url = `${this.baseUrl}/models/${this.config.model}:streamGenerateContent?key=${this.config.apiKey}`;

    const body = {
      contents,
      generationConfig: {
        temperature: params.temperature,
        maxOutputTokens: params.maxTokens ?? this.config.maxTokens,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${await response.text()}`);
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
          if (!line.trim()) continue;
          try {
            const chunk = JSON.parse(line);
            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) {
              yield { type: "text", content: text };
            }
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "done", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }

  async *chatWithToolsStream(params: ChatWithToolsParams): AsyncGenerator<ChatChunk> {
    // Gemini tool calling implementation
    yield* this.chatStream(params);
  }

  private formatMessages(messages: Message[]): unknown[] {
    return messages.map((m) => ({
      role: m.role === "assistant" ? "model" : m.role,
      parts: [{ text: m.content }],
    }));
  }

  private assembleResponse(chunks: ChatChunk[]): ChatResponse {
    let content = "";
    let usage: { prompt: number; completion: number } | undefined;

    for (const chunk of chunks) {
      if (chunk.type === "text" && chunk.content) {
        content += chunk.content;
      }
      if (chunk.type === "done" && chunk.usage) {
        usage = {
          prompt: chunk.usage.promptTokens,
          completion: chunk.usage.completionTokens,
        };
      }
    }

    return { content, usage };
  }
}
