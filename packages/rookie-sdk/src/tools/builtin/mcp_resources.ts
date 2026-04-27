// ─── MCP Resources Tools ─────────────────────────────────────────
// B10.7: List and read MCP resources

import { Tool } from "../types.js";
import { McpClient } from "../../mcp/client.js";

// Registry of connected MCP clients (populated by ToolRegistry.bootstrap)
const mcpClients = new Map<string, McpClient>();

export function registerMcpClient(serverName: string, client: McpClient): void {
  mcpClients.set(serverName, client);
}

export function unregisterMcpClient(serverName: string): void {
  mcpClients.delete(serverName);
}

export function getMcpClient(serverName: string): McpClient | undefined {
  return mcpClients.get(serverName);
}

export function getAllMcpClients(): Map<string, McpClient> {
  return new Map(mcpClients);
}

// MCP Resource types
interface McpResource {
  uri: string;
  name: string;
  mimeType?: string;
  description?: string;
}

interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
}

interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  mimeType?: string;
  description?: string;
}

/**
 * ListMcpResourcesTool - List all MCP resources from connected servers
 */
export const listMcpResourcesTool: Tool = {
  name: "list_mcp_resources",
  description:
    "List all resources exposed by connected MCP servers. " +
    "Resources include prompts, static resources, and resource templates. " +
    "Use this to discover available MCP capabilities before reading.",
  parameters: [
    {
      name: "serverName",
      type: "string",
      description: "Optional: filter to specific server only",
      required: false,
    },
    {
      name: "resourceType",
      type: "string",
      description: "Optional: filter by type ('prompt', 'resource', 'template')",
      required: false,
    },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    const serverFilter = params.serverName ? String(params.serverName) : undefined;
    const typeFilter = params.resourceType ? String(params.resourceType) : undefined;

    if (mcpClients.size === 0) {
      return "[INFO] No MCP servers connected.";
    }

    const results: string[] = [];

    for (const [serverName, client] of mcpClients) {
      if (serverFilter && serverName !== serverFilter) continue;

      results.push(`\n=== MCP Server: ${serverName} ===`);

      // Get prompts if type filter allows
      if (!typeFilter || typeFilter === "prompt") {
        try {
          // Access private prompts map through reflection or add getter to McpClient
          const prompts = (client as any).prompts as Map<string, McpPrompt> | undefined;
          if (prompts && prompts.size > 0) {
            results.push("\n--- Prompts ---");
            for (const [name, prompt] of prompts) {
              results.push(`  • ${name}${prompt.description ? ` - ${prompt.description}` : ""}`);
              if (prompt.arguments && prompt.arguments.length > 0) {
                const args = prompt.arguments.map(a =>
                  `${a.name}${a.required ? "*" : ""}`
                ).join(", ");
                results.push(`    Arguments: ${args}`);
              }
            }
          }
        } catch {
          // Server may not support prompts
        }
      }

      // Get resources if type filter allows
      if (!typeFilter || typeFilter === "resource") {
        try {
          const resources = (client as any).resources as Map<string, McpResource> | undefined;
          if (resources && resources.size > 0) {
            results.push("\n--- Resources ---");
            for (const [uri, resource] of resources) {
              results.push(`  • ${resource.name || uri}`);
              results.push(`    URI: ${uri}`);
              if (resource.description) results.push(`    Description: ${resource.description}`);
              if (resource.mimeType) results.push(`    Type: ${resource.mimeType}`);
            }
          }
        } catch {
          // Server may not support resources
        }
      }

      // Get resource templates if type filter allows
      if (!typeFilter || typeFilter === "template") {
        try {
          const templates = (client as any).resourceTemplates as Map<string, McpResourceTemplate> | undefined;
          if (templates && templates.size > 0) {
            results.push("\n--- Resource Templates ---");
            for (const [name, template] of templates) {
              results.push(`  • ${template.name || name}`);
              results.push(`    Template: ${template.uriTemplate}`);
              if (template.description) results.push(`    Description: ${template.description}`);
            }
          }
        } catch {
          // Server may not support templates
        }
      }
    }

    if (results.length === 0) {
      return "[INFO] No MCP resources found matching the criteria.";
    }

    return results.join("\n");
  },
};

/**
 * ReadMcpResourceTool - Read a specific MCP resource
 */
export const readMcpResourceTool: Tool = {
  name: "read_mcp_resource",
  description:
    "Read the content of an MCP resource by URI. " +
    "Use list_mcp_resources first to discover available resources.",
  parameters: [
    {
      name: "serverName",
      type: "string",
      description: "MCP server name",
      required: true,
    },
    {
      name: "resourceUri",
      type: "string",
      description: "Resource URI to read",
      required: true,
    },
    {
      name: "arguments",
      type: "object",
      description: "Optional: template arguments for resource templates",
      required: false,
    },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    const serverName = String(params.serverName);
    const resourceUri = String(params.resourceUri);
    const args = params.arguments as Record<string, string> | undefined;

    const client = mcpClients.get(serverName);
    if (!client) {
      return `[ERROR] MCP server not found: ${serverName}`;
    }

    try {
      // For prompts, use getPrompt if available
      const prompts = (client as any).prompts as Map<string, McpPrompt> | undefined;
      if (prompts?.has(resourceUri)) {
        // This is a prompt, get it with arguments
        const response = await (client as any).call("prompts/get", {
          name: resourceUri,
          arguments: args,
        });

        const result = response.result as { messages?: Array<{ role: string; content: { text?: string } }> } | undefined;
        if (result?.messages) {
          return result.messages.map(m => `[${m.role}] ${m.content.text || ""}`).join("\n\n");
        }
        return JSON.stringify(result, null, 2);
      }

      // For resources, use readResource
      const content = await client.readResource(resourceUri);
      return typeof content === "string" ? content : JSON.stringify(content, null, 2);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[ERROR] Failed to read resource: ${msg}`;
    }
  },
};
