/**
 * NAPI-RS TypeScript Type Definitions
 * Auto-generated from Rust source using napi-rs bindings
 */

// ─── Tokenizer Types ─────────────────────────────────────────────

export interface TokenCountRequest {
  text: string;
  model?: string; // "cl100k_base" | "o200k_base"
}

export interface TokenCountResponse {
  count: number;
  model: string;
}

export interface TruncateRequest {
  text: string;
  maxTokens: number;
  model?: string;
}

export interface TruncateResponse {
  text: string;
  originalCount: number;
  truncatedCount: number;
}

// ─── Context Pipeline Types ──────────────────────────────────────

export interface PipelineToolCall {
  id: string;
  name: string;
  params: string; // JSON string
}

export interface PipelineMessage {
  role: string; // "user" | "assistant" | "system" | "tool"
  content: string;
  toolCalls?: PipelineToolCall[];
  toolCallId?: string;
  metadata?: string; // JSON string
}

export interface PipelineConfig {
  maxToolResultTokens?: number;
  snipThreshold?: number;
  maxMessages?: number;
  compactThreshold?: number;
  contextWindow?: number;
}

export interface PipelineStats {
  stage1ToolResults: number;
  stage2Snipped: number;
  stage3Normalized: number;
  stage4Collapsed: number;
  stage5Compacted: number;
  totalTokensBefore: number;
  totalTokensAfter: number;
}

export interface PipelineResponse {
  messages: PipelineMessage[];
  stats: PipelineStats;
}

// ─── NAPI Addon Interface ────────────────────────────────────────

export interface RookieNapiAddon {
  /** Create a new RookieNapi instance */
  new(): RookieNapiAddon;
  
  /** Initialize the addon with configuration */
  init(config: string): Promise<boolean>;
  
  /** Ping the native addon for health check */
  ping(): Promise<string>;
  
  /** Count tokens in text using tiktoken */
  countTokens(request: TokenCountRequest): Promise<TokenCountResponse>;
  
  /** Truncate text to max tokens */
  truncateToTokens(request: TruncateRequest): Promise<TruncateResponse>;
  
  /** Run the 5-stage context pipeline */
  runContextPipeline(
    messages: PipelineMessage[],
    config?: PipelineConfig
  ): Promise<PipelineResponse>;
  
  /** Process a generic request (backward compatibility) */
  request(data: string): Promise<string>;
  
  /** Register an event callback */
  onEvent(callback: (event: string) => void): void;
  
  /** Close the addon connection */
  close(): Promise<void>;
}

// ─── Native Module Loader ────────────────────────────────────────

export interface NativeModule {
  RookieNapi: new () => RookieNapiAddon;
}

/** Load the native addon based on platform */
export function loadNativeAddon(): NativeModule {
  const platform = process.platform;
  const arch = process.arch;
  
  // Determine the correct binary name based on platform
  const binaryName = `rookie-napi.${platform}-${arch}.node`;
  
  // Try to load from various locations
  const paths = [
    `./native/${binaryName}`,
    `../native/${binaryName}`,
    `@rookie-agent/native/${binaryName}`,
    `rookie-napi-${platform}-${arch}`,
  ];
  
  for (const path of paths) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const addon = require(path);
      return addon as NativeModule;
    } catch {
      // Try next path
    }
  }
  
  throw new Error(
    `Failed to load native addon for ${platform}-${arch}. ` +
    `Make sure to run 'npm run build:native' first.`
  );
}
