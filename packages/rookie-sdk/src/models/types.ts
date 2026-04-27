import { Message } from "../agent/types.js";

// ─── Model Capabilities ──────────────────────────────────────────

export interface ModelCapabilities {
  streaming: boolean;
  functionCalling: boolean;
  vision: boolean;
  maxTokens: number;
  contextWindow: number;
}

// ─── Tool Definition (for function calling) ──────────────────────

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ─── Chat Params ─────────────────────────────────────────────────

export interface ChatParams {
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

export interface ChatWithToolsParams extends ChatParams {
  tools: ToolDefinition[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
}

// ─── Streaming Chunks ────────────────────────────────────────────

export interface ChatChunk {
  type: "text" | "tool_call" | "tool_call_delta" | "done";
  content?: string;
  toolCall?: { id: string; name: string; arguments: string };
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

// ─── Non-streaming Response (convenience) ────────────────────────

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage?: { prompt: number; completion: number };
}

// ─── Provider Interface ──────────────────────────────────────────

export interface ModelProvider {
  name: string;
  capabilities: ModelCapabilities;

  /** Streaming chat (primary interface). */
  chatStream(params: ChatParams): AsyncGenerator<ChatChunk>;

  /** Streaming chat with tool definitions. */
  chatWithToolsStream(params: ChatWithToolsParams): AsyncGenerator<ChatChunk>;

  /** Non-streaming convenience wrapper (consumes the stream). */
  chat(messages: Message[]): Promise<ChatResponse>;

  /** Embedding (optional). */
  embed?(texts: string[]): Promise<number[][]>;
}
