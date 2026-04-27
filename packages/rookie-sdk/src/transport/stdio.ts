import { spawn, ChildProcess } from "child_process";
import { Transport, JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "./types.js";

export interface StdioTransportOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export class StdioTransport implements Transport {
  private process: ChildProcess | null = null;
  private pendingRequests = new Map<number | string, (response: JsonRpcResponse) => void>();
  private notificationHandler: ((notification: JsonRpcNotification) => void) | null = null;
  private buffer = "";
  private started = false;

  constructor(private options: StdioTransportOptions) {}

  async start(): Promise<void> {
    if (this.started) return;

    return new Promise((resolve, reject) => {
      this.process = spawn(this.options.command, this.options.args ?? [], {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.process.stdout?.on("data", (data: Buffer) => {
        this.handleData(data.toString());
      });

      this.process.stderr?.on("data", (data: Buffer) => {
        console.error(`[rookie-core stderr] ${data.toString().trim()}`);
      });

      this.process.on("error", reject);
      this.process.on("spawn", () => {
        this.started = true;
        resolve();
      });

      this.process.on("exit", (_code) => {
        this.started = false;
        this.process = null;
      });
    });
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    this.started = false;
  }

  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin || !this.started) {
        reject(new Error("Transport not started"));
        return;
      }

      this.pendingRequests.set(request.id, resolve);

      const message = JSON.stringify(request) + "\n";
      this.process.stdin.write(message, (err) => {
        if (err) reject(err);
      });
    });
  }

  onNotification(handler: (notification: JsonRpcNotification) => void): void {
    this.notificationHandler = handler;
  }

  private handleData(data: string): void {
    this.buffer += data;

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line) {
        try {
          const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;

          if ("id" in message && message.id !== undefined) {
            const resolve = this.pendingRequests.get(message.id);
            if (resolve) {
              this.pendingRequests.delete(message.id);
              resolve(message as JsonRpcResponse);
            }
          } else if ("method" in message) {
            this.notificationHandler?.(message as JsonRpcNotification);
          }
        } catch (e) {
          // Ignore non-JSON output
        }
      }
    }
  }
}
