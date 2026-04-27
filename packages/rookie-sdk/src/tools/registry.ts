import { Tool } from "./types.js";
import { PermissionManager } from "../permissions/manager.js";
import { AskDecision } from "../permissions/types.js";
import { HookRegistry } from "../hooks/registry.js";
import { HookContext } from "../hooks/types.js";
import { RookieError, ErrorCode } from "../errors.js";
import { McpClient } from "../mcp/client.js";
import { McpServerConfig } from "../mcp/types.js";
import { StdioMcpTransport } from "../mcp/stdio-transport.js";

/**
 * Host-provided approval callback. Returning a boolean keeps the v1 contract
 * (`true` = allow once). Returning an `AskDecision` unlocks the three-tier
 * `once / session / forever` behaviour introduced in P0-T4.
 */
export type AskPermissionResponse = boolean | AskDecision;

export interface ToolRegistryOptions {
  permissions?: PermissionManager;
  hooks?: HookRegistry;
  sessionId?: string;
  projectRoot?: string;
  /** Called when a tool requires user confirmation ("ask" permission). */
  onAskPermission?: (
    toolName: string,
    params: Record<string, unknown>,
  ) => Promise<AskPermissionResponse>;
  /** B2: MCP server configurations for auto-registration */
  mcpServers?: Record<string, McpServerConfig>;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  private permissions?: PermissionManager;
  private hooks?: HookRegistry;
  private sessionId: string;
  private projectRoot: string;
  private onAskPermission?: (
    toolName: string,
    params: Record<string, unknown>,
  ) => Promise<AskPermissionResponse>;
  private mcpServers?: Record<string, McpServerConfig>;
  private mcpClients = new Map<string, McpClient>();
  // A4: Read-only mode for plan mode
  private readOnlyMode = false;

  constructor(options?: ToolRegistryOptions) {
    this.permissions = options?.permissions;
    this.hooks = options?.hooks;
    this.sessionId = options?.sessionId || "default";
    this.projectRoot = options?.projectRoot || process.cwd();
    this.onAskPermission = options?.onAskPermission;
    this.mcpServers = options?.mcpServers;
  }

  // A4: Set read-only mode (plan mode)
  setReadOnly(flag: boolean): void {
    this.readOnlyMode = flag;
  }

  // A4: Check if in read-only mode
  isReadOnly(): boolean {
    return this.readOnlyMode;
  }

  // A4: Get list of read-only tools
  getReadOnlyTools(): Tool[] {
    return this.list().filter(tool => this.isToolReadOnly(tool));
  }

  // A4: Check if a tool is read-only
  private isToolReadOnly(tool: Tool): boolean {
    // Explicitly marked as read-only
    if (tool.isReadOnly === true) return true;
    // Known read-only tool names
    const readOnlyToolNames = [
      "file_read", "glob_files", "grep_search", "search_code",
      "git_status", "git_diff", "git_log", "web_search", "web_fetch",
    ];
    if (readOnlyToolNames.includes(tool.name)) return true;
    // Tools that modify state are NOT read-only
    const writeToolNames = [
      "file_write", "file_edit", "shell_execute", "git_commit",
      "git_checkout", "git_branch", "todo_write",
    ];
    if (writeToolNames.includes(tool.name)) return false;
    // Default: assume read-only for safety
    return true;
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  // B1: List tools with JSON Schema for LLM consumption
  listWithSchema(): Array<Tool & { jsonSchema?: Record<string, unknown> }> {
    return Array.from(this.tools.values()).map(tool => {
      // Convert Zod schema to JSON schema object if available
      const jsonSchema = tool.inputSchema
        ? { jsonSchema: { type: "zod_schema", name: tool.name } as Record<string, unknown> }
        : {};
      return {
        ...tool,
        ...jsonSchema,
      };
    });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Invoke a tool with full permission check and hook lifecycle.
   *
   * Flow:
   *   1. A4: Read-only mode check (plan mode)
   *   2. Permission check (allow/deny/ask)
   *   3. Fire PreToolUse hooks (can reject)
   *   4. Execute tool
   *   5. Fire PostToolUse hooks (can modify result)
   *   6. Return result
   */
  async invoke(name: string, params: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new RookieError(ErrorCode.TOOL_NOT_FOUND, `Tool not found: ${name}`, {
        context: { toolName: name },
      });
    }

    // ── Step 1: A4 Read-only mode check ───────────────────────
    if (this.readOnlyMode && !this.isToolReadOnly(tool)) {
      throw new RookieError(
        ErrorCode.TOOL_PERMISSION_DENIED,
        `Tool "${name}" is not available in plan mode. ` +
        `Plan mode only allows read-only tools (file_read, grep, glob, etc.). ` +
        `Exit plan mode to use this tool.`,
        { context: { toolName: name, mode: "plan" } }
      );
    }

    // ── Step 2: Permission check ──────────────────────────────
    if (this.permissions) {
      const action = this.permissions.check(name, params);

      if (action === "deny") {
        throw new RookieError(ErrorCode.TOOL_PERMISSION_DENIED, `Tool "${name}" is denied by permission rules`, {
          context: { toolName: name, params },
        });
      }

      if (action === "ask") {
        if (this.onAskPermission) {
          const response = await this.onAskPermission(name, params);
          const decision: AskDecision =
            typeof response === "boolean" ? { allowed: response } : response;

          // Persist session / forever preferences and let hosts audit the call.
          await this.permissions.applyAskDecision(name, decision, params);
          if (this.hooks) {
            await this.hooks.fire("OnPermissionAsk", {
              sessionId: this.sessionId,
              toolName: name,
              toolInput: params,
              projectRoot: this.projectRoot,
              permissionDecision: {
                allowed: decision.allowed,
                remember: decision.remember ?? "once",
              },
            });
          }

          if (!decision.allowed) {
            throw new RookieError(ErrorCode.TOOL_PERMISSION_DENIED, `User denied permission for tool "${name}"`, {
              context: { toolName: name, params },
            });
          }
        }
        // If no onAskPermission callback, default to allow
      }
    }

    // ── Step 2: PreToolUse hooks ──────────────────────────────
    if (this.hooks) {
      const hookCtx: HookContext = {
        sessionId: this.sessionId,
        toolName: name,
        toolInput: params,
        projectRoot: this.projectRoot,
      };

      const preResults = await this.hooks.fire("PreToolUse", hookCtx);
      for (const r of preResults) {
        if (r.rejected) {
          throw new RookieError(ErrorCode.HOOK_REJECTED, `PreToolUse hook rejected tool "${name}": ${r.output || "no reason"}`, {
            context: { toolName: name, hook: r.hook },
          });
        }
      }
    }

    // ── Step 3: Execute tool ──────────────────────────────────
    let output: string;
    try {
      const rawOutput = await tool.execute(params);
      output = String(rawOutput);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new RookieError(ErrorCode.TOOL_EXECUTION_ERROR, `Tool "${name}" execution failed: ${message}`, {
        cause: e instanceof Error ? e : undefined,
        context: { toolName: name, params },
      });
    }

    // ── Step 4: PostToolUse hooks ─────────────────────────────
    if (this.hooks) {
      const hookCtx: HookContext = {
        sessionId: this.sessionId,
        toolName: name,
        toolInput: params,
        toolOutput: output,
        projectRoot: this.projectRoot,
      };

      // PostToolUse hooks run but don't reject; they can log, format, etc.
      await this.hooks.fire("PostToolUse", hookCtx);
    }

    return output;
  }

  /** Update runtime options (e.g., when session starts). */
  setOptions(options: Partial<ToolRegistryOptions>): void {
    if (options.permissions) this.permissions = options.permissions;
    if (options.hooks) this.hooks = options.hooks;
    if (options.sessionId) this.sessionId = options.sessionId;
    if (options.projectRoot) this.projectRoot = options.projectRoot;
    if (options.onAskPermission) this.onAskPermission = options.onAskPermission;
    if (options.mcpServers) this.mcpServers = options.mcpServers;
  }

  // B2: Bootstrap MCP servers and auto-register tools
  async bootstrap(): Promise<{ registered: number; errors: string[] }> {
    const errors: string[] = [];
    let registered = 0;

    if (!this.mcpServers || Object.keys(this.mcpServers).length === 0) {
      return { registered, errors };
    }

    for (const [serverName, config] of Object.entries(this.mcpServers)) {
      try {
        if (config.autoRegister === false) continue;

        const client = await this.connectMcpServer(serverName, config);
        if (!client) continue;

        const tools = client.getTools();
        for (const mcpTool of tools) {
          // Register with prefixed name: mcp__{server}__{tool}
          const toolName = `mcp__${serverName}__${mcpTool.name}`;
          this.register({
            name: toolName,
            description: `[MCP:${serverName}] ${mcpTool.description}`,
            parameters: Object.entries(mcpTool.inputSchema.properties || {}).map(([name, prop]: [string, any]) => ({
              name,
              type: prop.type || "string",
              description: prop.description || `${name} parameter`,
              required: Array.isArray(mcpTool.inputSchema.required) && mcpTool.inputSchema.required.includes(name),
            })),
            execute: async (params) => {
              return client.callTool(mcpTool.name, params);
            },
            isReadOnly: true, // Assume MCP tools are read-only by default
            isConcurrencySafe: true,
          });
          registered++;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`MCP server "${serverName}": ${msg}`);
        // Graceful degradation - continue with other servers
      }
    }

    return { registered, errors };
  }

  // B2: Connect to a single MCP server
  private async connectMcpServer(serverName: string, config: McpServerConfig): Promise<McpClient | null> {
    if (this.mcpClients.has(serverName)) {
      return this.mcpClients.get(serverName)!;
    }

    let client: McpClient;

    switch (config.transport) {
      case "stdio":
        if (!config.command) {
          throw new Error(`MCP server "${serverName}" missing command for stdio transport`);
        }
        const transport = new StdioMcpTransport({
          command: config.command,
          args: config.args || [],
          env: config.env,
        });
        client = new McpClient(transport);
        break;
      case "inprocess":
        // In-process transport would be implemented separately
        throw new Error(`In-process transport not yet implemented for "${serverName}"`);
      case "sse":
        throw new Error(`SSE transport not yet implemented for "${serverName}"`);
      default:
        throw new Error(`Unknown transport type for "${serverName}"`);
    }

    await client.connect();
    this.mcpClients.set(serverName, client);
    return client;
  }

  // B2: Disconnect all MCP clients
  async shutdown(): Promise<void> {
    for (const [name, client] of this.mcpClients) {
      try {
        await client.disconnect();
      } catch (e) {
        // Log but don't throw during shutdown
        console.error(`Error disconnecting MCP server "${name}":`, e);
      }
    }
    this.mcpClients.clear();
  }
}
