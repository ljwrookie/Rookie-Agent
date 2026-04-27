import { Transport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "./types.js";

export class InProcTransport implements Transport {
  private handler: ((request: JsonRpcRequest) => Promise<JsonRpcResponse>) | null = null;
  private notificationHandler: ((notification: JsonRpcNotification) => void) | null = null;

  setHandler(handler: (request: JsonRpcRequest) => Promise<JsonRpcResponse>): void {
    this.handler = handler;
  }

  async start(): Promise<void> {
    // No-op for in-process transport
  }

  async stop(): Promise<void> {
    this.handler = null;
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (!this.handler) {
      throw new Error("No handler registered");
    }
    return this.handler(request);
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  emitNotification(notification: JsonRpcNotification): void {
    this.notificationHandler?.(notification);
  }
}
