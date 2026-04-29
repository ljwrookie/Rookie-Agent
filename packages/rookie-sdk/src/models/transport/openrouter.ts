/**
 * OpenRouter Transport
 *
 * Extends OpenAI ChatCompletions with OpenRouter-specific headers
 * OpenRouter provides a unified API for many models.
 */

import { OpenAIChatCompletionsTransport } from "./openai.js";

export interface OpenRouterConfig {
  apiKey: string;
  siteUrl?: string;
  siteName?: string;
}

export class OpenRouterTransport extends OpenAIChatCompletionsTransport {
  readonly name = "openrouter";
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    super("https://openrouter.ai/api/v1");
    this.config = config;
  }

  getHeaders(_apiKey: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.config.apiKey}`,
      "HTTP-Referer": this.config.siteUrl || "https://rookie-agent.dev",
      "X-Title": this.config.siteName || "Rookie Agent",
    };

    return headers;
  }

  getChatBody(
    messages: import("../../agent/types.js").Message[],
    options: {
      model: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      tools?: import("../types.js").ToolDefinition[];
      toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
    }
  ): Record<string, unknown> {
    const body = super.getChatBody(messages, options);

    // OpenRouter-specific: Add transforms for better compatibility
    body.transforms = ["middle-out"];

    return body;
  }
}
