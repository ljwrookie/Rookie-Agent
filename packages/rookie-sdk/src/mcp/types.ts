// MCP (Model Context Protocol) types
// Based on https://modelcontextprotocol.io

// B2: MCP Server configuration for settings.json
export interface McpServerConfig {
  name: string;
  transport: "stdio" | "inprocess" | "sse";
  // For stdio transport
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // For inprocess transport
  module?: string;
  // For sse transport
  url?: string;
  // Auto-discover and register tools
  autoRegister?: boolean;
}

// B2: MCP registry configuration
export interface McpRegistryConfig {
  servers: Record<string, McpServerConfig>;
  enabled?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpServerCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
}

export interface McpServerInfo {
  name: string;
  version: string;
  capabilities: McpServerCapabilities;
}

export interface McpRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpTransport {
  send(request: McpRequest): Promise<McpResponse>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
