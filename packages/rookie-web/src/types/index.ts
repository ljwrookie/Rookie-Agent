/** Conversation types */
export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  status: "active" | "archived" | "error";
  metadata?: Record<string, unknown>;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  tokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
}

/** Memory types */
export interface MemoryEntry {
  id: string;
  type: "fact" | "preference" | "context" | "summary";
  content: string;
  source: string;
  confidence: number;
  createdAt: string;
  lastAccessed?: string;
  accessCount: number;
  embedding?: number[];
}

export interface MemoryQuery {
  query: string;
  limit?: number;
  threshold?: number;
  types?: string[];
}

/** Skill types */
export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  status: "active" | "inactive" | "error";
  tools: string[];
  triggers: string[];
  usageCount: number;
  createdAt: string;
}

/** Model types */
export interface ModelConfig {
  id: string;
  provider: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  enabled: boolean;
  priority: number;
}

export interface ModelHealth {
  modelId: string;
  status: "healthy" | "degraded" | "unavailable";
  latency: number;
  successRate: number;
  lastCheck: string;
  error?: string;
}

/** Gateway types */
export interface GatewayStatus {
  id: string;
  name: string;
  type: string;
  status: "connected" | "disconnected" | "error";
  connectedSince?: string;
  messageCount: number;
  errorCount: number;
  lastActivity?: string;
}

/** Log types */
export interface LogEntry {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  source: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface LogFilter {
  level?: string;
  source?: string;
  startTime?: string;
  endTime?: string;
  search?: string;
}

/** System stats */
export interface SystemStats {
  uptime: number;
  memory: {
    used: number;
    total: number;
    percentage: number;
  };
  cpu: {
    usage: number;
    cores: number;
  };
  activeConversations: number;
  totalMessages: number;
  pendingTasks: number;
}

/** WebSocket message types */
export type WebSocketMessage =
  | { type: "ping" }
  | { type: "pong" }
  | { type: "stats"; data: SystemStats }
  | { type: "conversation_update"; data: Conversation }
  | { type: "new_message"; data: Message }
  | { type: "log_entry"; data: LogEntry }
  | { type: "gateway_update"; data: GatewayStatus }
  | { type: "error"; message: string };
