export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface Transport {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  onNotification(handler: (notification: JsonRpcNotification) => void): void;
}
