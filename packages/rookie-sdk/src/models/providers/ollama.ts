/**
 * Ollama Provider (Local LLM)
 *
 * ~35 lines of code thanks to Transport abstraction
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

export interface OllamaConfig {
  baseUrl?: string;
  model: string;
}

export class OllamaProvider implements ModelProvider {
  name: string;
  capabilities: ModelCapabilities;
  private config: Required<OllamaConfig>;

  constructor(config: OllamaConfig) {
    this.config = {
      baseUrl: "http://localhost:11434",
      ...config,
    };
    this.name = this.config.model;
    this.capabilities = {
      streaming: true,
      functionCalling: false, // Limited support in Ollama
      vision: false,
      maxTokens: 4096,
      contextWindow: 8192,
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
    const url = `${this.config.baseUrl}/api/chat`;

    const body = {
      model: this.config.model,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      stream: true,
      options: {
        temperature: params.temperature,
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${await response.text()}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.message?.content) {
              yield { type: "text", content: data.message.content };
            }
            if (data.done) {
              yield {
                type: "done",
                usage: {
                  promptTokens: data.prompt_eval_count || 0,
                  completionTokens: data.eval_count || 0,
                  totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
                },
              };
            }
          } catch {
            // Ignore malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async *chatWithToolsStream(_params: ChatWithToolsParams): AsyncGenerator<ChatChunk> {
    throw new Error("Ollama does not support function calling in this implementation");
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
