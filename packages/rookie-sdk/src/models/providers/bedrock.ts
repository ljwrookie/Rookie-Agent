/**
 * AWS Bedrock Provider
 *
 * ~40 lines of code thanks to Transport abstraction
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

export interface BedrockConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  model?: string;
  maxTokens?: number;
}

export class BedrockProvider implements ModelProvider {
  name: string;
  capabilities: ModelCapabilities;
  private config: Required<Pick<BedrockConfig, "accessKeyId" | "secretAccessKey" | "region" | "model">> & BedrockConfig;
  private transport: OpenAIChatCompletionsTransport;

  constructor(config: BedrockConfig) {
    this.config = {
      region: "us-east-1",
      model: "anthropic.claude-3-sonnet-20240229-v1:0",
      maxTokens: 4096,
      ...config,
    };
    this.name = this.config.model;
    this.capabilities = {
      streaming: true,
      functionCalling: true,
      vision: this.config.model.includes("claude-3"),
      maxTokens: this.config.maxTokens ?? 4096,
      contextWindow: 200000,
    };
    // Bedrock supports OpenAI-compatible API via invoke-model
    this.transport = new OpenAIChatCompletionsTransport(
      `https://bedrock-runtime.${this.config.region}.amazonaws.com`
    );
  }

  async chat(messages: Message[]): Promise<ChatResponse> {
    const chunks: ChatChunk[] = [];
    for await (const chunk of this.chatStream({ messages })) {
      chunks.push(chunk);
    }
    return this.assembleResponse(chunks);
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
    yield* this.doRequest(params);
  }

  async *chatWithToolsStream(params: ChatWithToolsParams): AsyncGenerator<ChatChunk> {
    yield* this.doRequest(params);
  }

  private async *doRequest(
    params: ChatParams & Partial<ChatWithToolsParams>
  ): AsyncGenerator<ChatChunk> {
    // AWS SigV4 signing required - simplified for demo
    // In production, use @aws-sdk/client-bedrock-runtime.
    // Reference values preserved for future implementation; cast to void so
    // the linter does not flag them as unused while the stub throws below.
    void `${this.transport.baseUrl}/model/${this.config.model}/invoke`;
    void this.transport.getChatBody(params.messages, {
      model: this.config.model,
      temperature: params.temperature,
      maxTokens: params.maxTokens ?? this.config.maxTokens,
      stream: true,
      tools: params.tools,
      toolChoice: params.toolChoice,
    });

    // Note: Full implementation requires AWS SigV4 signing
    // This is a simplified structure showing the Transport pattern
    throw new Error("AWS SigV4 signing required - use @aws-sdk/client-bedrock-runtime");
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
