import { McpTool, McpResource, McpServerInfo, McpRequest, McpResponse, McpTransport } from "./types.js";

export class McpClient {
  private transport: McpTransport;
  private serverInfo?: McpServerInfo;
  private tools = new Map<string, McpTool>();
  private resources = new Map<string, McpResource>();

  constructor(transport: McpTransport) {
    this.transport = transport;
  }

  async connect(): Promise<void> {
    await this.transport.connect();

    // Initialize and get server info
    const response = await this.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "rookie-agent", version: "0.1.0" },
    });

    this.serverInfo = response.result as McpServerInfo;

    // Discover tools if supported
    if (this.serverInfo.capabilities.tools) {
      await this.discoverTools();
    }

    // Discover resources if supported
    if (this.serverInfo.capabilities.resources) {
      await this.discoverResources();
    }
  }

  async disconnect(): Promise<void> {
    await this.transport.disconnect();
  }

  async discoverTools(): Promise<McpTool[]> {
    const response = await this.call("tools/list", {});
    const toolList = (response.result as any)?.tools || [];

    for (const tool of toolList) {
      this.tools.set(tool.name, tool);
    }

    return toolList;
  }

  async discoverResources(): Promise<McpResource[]> {
    const response = await this.call("resources/list", {});
    const resourceList = (response.result as any)?.resources || [];

    for (const resource of resourceList) {
      this.resources.set(resource.uri, resource);
    }

    return resourceList;
  }

  async callTool(name: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.tools.has(name)) {
      throw new Error(`Tool not found: ${name}`);
    }

    const response = await this.call("tools/call", { name, arguments: params });
    return response.result;
  }

  async readResource(uri: string): Promise<unknown> {
    if (!this.resources.has(uri)) {
      throw new Error(`Resource not found: ${uri}`);
    }

    const response = await this.call("resources/read", { uri });
    return response.result;
  }

  getTools(): McpTool[] {
    return Array.from(this.tools.values());
  }

  getResources(): McpResource[] {
    return Array.from(this.resources.values());
  }

  getServerInfo(): McpServerInfo | undefined {
    return this.serverInfo;
  }

  private async call(method: string, params: Record<string, unknown>): Promise<McpResponse> {
    const request: McpRequest = {
      jsonrpc: "2.0",
      id: Math.random().toString(36).slice(2),
      method,
      params,
    };

    return this.transport.send(request);
  }
}
