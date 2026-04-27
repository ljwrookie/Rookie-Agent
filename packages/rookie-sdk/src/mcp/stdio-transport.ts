import { spawn, ChildProcess } from "child_process";
import { McpRequest, McpResponse, McpTransport } from "./types.js";

/**
 * StdioMcpTransport: connects to an MCP server via stdio (stdin/stdout).
 *
 * This is the standard transport for local MCP servers.
 * The server is spawned as a child process and communicates via JSON-RPC over stdio.
 */
export class StdioMcpTransport implements McpTransport {
  private command: string;
  private args: string[];
  private env?: Record<string, string>;
  private cwd?: string;

  private childProc: ChildProcess | null = null;
  private pendingRequests = new Map<string | number, {
    resolve: (resp: McpResponse) => void;
    reject: (err: Error) => void;
  }>();
  private buffer = "";

  constructor(options: StdioMcpTransportOptions) {
    this.command = options.command;
    this.args = options.args || [];
    this.env = options.env;
    this.cwd = options.cwd;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.childProc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
      });

      this.childProc.stdout?.on("data", (data: Buffer) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.childProc.stderr?.on("data", (_data: Buffer) => {
        // MCP servers may log to stderr — ignore for now
      });

      this.childProc.on("error", (err) => {
        reject(new Error(`Failed to start MCP server: ${err.message}`));
      });

      this.childProc.on("exit", (code) => {
        for (const [, pending] of this.pendingRequests) {
          pending.reject(new Error(`MCP server exited with code ${code}`));
        }
        this.pendingRequests.clear();
        this.childProc = null;
      });

      setTimeout(() => resolve(), 100);
    });
  }

  async disconnect(): Promise<void> {
    if (this.childProc) {
      // Send SIGTERM for graceful shutdown
      const proc = this.childProc;
      proc.kill("SIGTERM");

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          proc.kill("SIGKILL");
          resolve();
        }, 5000);

        proc.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      this.childProc = null;
    }
  }

  async send(request: McpRequest): Promise<McpResponse> {
    if (!this.childProc?.stdin?.writable) {
      throw new Error("MCP server is not connected");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(new Error(`MCP request timed out: ${request.method}`));
      }, 30000);

      this.pendingRequests.set(request.id, {
        resolve: (resp) => {
          clearTimeout(timeout);
          resolve(resp);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      const line = JSON.stringify(request) + "\n";
      this.childProc!.stdin!.write(line);
    });
  }

  // ── Internal ──────────────────────────────────────────────────

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const response = JSON.parse(trimmed) as McpResponse;
        if (response.id !== undefined) {
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            pending.resolve(response);
          }
        }
      } catch {
        // Malformed JSON — ignore
      }
    }
  }
}

export interface StdioMcpTransportOptions {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}
