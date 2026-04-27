import { McpResource, McpServerCapabilities, McpRequest, McpResponse, McpTransport } from "./types.js";
import { Tool } from "../tools/types.js";

export interface McpServerConfig {
  name: string;
  version: string;
  capabilities: McpServerCapabilities;
}

export class McpServer {
  private config: McpServerConfig;
  private tools = new Map<string, Tool>();
  private resources = new Map<string, McpResource>();
  private transport: McpTransport;

  constructor(config: McpServerConfig, transport: McpTransport) {
    this.config = config;
    this.transport = transport;
  }

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  registerResource(resource: McpResource): void {
    this.resources.set(resource.uri, resource);
  }

  async start(): Promise<void> {
    await this.transport.connect();
  }

  async stop(): Promise<void> {
    await this.transport.disconnect();
  }

  async handleRequest(request: McpRequest): Promise<McpResponse> {
    const { method, params = {} } = request;

    switch (method) {
      case "initialize": {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: this.config.name,
              version: this.config.version,
            },
            capabilities: this.config.capabilities,
          },
        };
      }

      case "tools/list": {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: Array.from(this.tools.values()).map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: this.parametersToSchema(t.parameters),
            })),
          },
        };
      }

      case "tools/call": {
        const toolName = (params as any).name as string;
        const toolArgs = (params as any).arguments as Record<string, unknown> || {};
        const tool = this.tools.get(toolName);

        if (!tool) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32602, message: `Tool not found: ${toolName}` },
          };
        }

        // v2: Actually execute the tool
        try {
          const output = await tool.execute(toolArgs);
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [{ type: "text", text: String(output) }],
            },
          };
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          return {
            jsonrpc: "2.0",
            id: request.id,
            result: {
              content: [{ type: "text", text: `Error: ${error}` }],
              isError: true,
            },
          };
        }
      }

      case "resources/list": {
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            resources: Array.from(this.resources.values()),
          },
        };
      }

      case "resources/read": {
        const uri = (params as any).uri as string;
        const resource = this.resources.get(uri);

        if (!resource) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: -32602, message: `Resource not found: ${uri}` },
          };
        }

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            contents: [{ uri, mimeType: resource.mimeType, text: "" }],
          },
        };
      }

      default:
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
    }
  }

  private parametersToSchema(
    parameters: Array<{ name: string; type: string; description: string; required?: boolean }>
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const param of parameters) {
      properties[param.name] = {
        type: param.type,
        description: param.description,
      };
      if (param.required !== false) {
        required.push(param.name);
      }
    }

    return { type: "object", properties, required };
  }
}
