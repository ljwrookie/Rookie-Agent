import type { ZodType, z } from "zod";

// B1: Legacy Tool interface (backward compatible)
export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute(params: Record<string, unknown>): Promise<unknown>;
  // B1: Optional new fields for enhanced tools
  isReadOnly?: boolean;
  isConcurrencySafe?: boolean;
  inputSchema?: ZodType<unknown>;
  outputSchema?: ZodType<unknown>;
  // A4: Destructive flag for permission escalation
  isDestructive?: boolean;
}

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

// B1: Permission matcher for fine-grained permission control
export interface PermissionMatcher {
  tool: string;
  args?: Record<string, unknown>;
}

// B1: Retry policy configuration
export interface RetryPolicy {
  maxRetries: number;
  retryDelayMs: number;
  retryableErrors?: string[];
}

// B1: Tool metrics for monitoring
export interface ToolMetrics {
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

// B1: New structured Tool definition with generics (CCB-aligned 35 fields)
export interface ToolDefinition<I = unknown, O = unknown, P = unknown> {
  // --- Core fields (4) ---
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema?: ZodType<O>;
  execute: (input: I, onProgress?: (progress: P) => void) => Promise<O>;

  // --- Registration & Discovery (6) ---
  aliases?: string[];
  searchHint?: string;
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  isEnabled?: (ctx: { projectRoot: string; sessionId: string }) => boolean;
  toolGroup?: string;

  // --- Safety & Permissions (7) ---
  isReadOnly?: boolean;
  isDestructive?: boolean;
  isConcurrencySafe?: boolean;
  validateInput?: (input: I) => { valid: boolean; error?: string };
  checkPermissions?: (input: I, ctx: { projectRoot: string; sessionId: string }) => { allowed: boolean; reason?: string };
  preparePermissionMatcher?: (input: I) => PermissionMatcher;
  interruptBehavior?: "allow" | "ignore" | "abort";

  // --- Output & Rendering (4) ---
  maxResultSizeChars?: number;
  mapToolResultToToolResultBlockParam?: (result: O) => Record<string, unknown>;
  renderToolResultMessage?: (result: O) => string;
  renderToolUseMessage?: (input: I) => string;

  // --- Context (2) ---
  prompt?: () => string | undefined;
  getPath?: (input: I) => string | undefined;

  // --- Execution Control (3) ---
  timeout?: number;
  retryPolicy?: RetryPolicy;
  abortSignal?: AbortSignal;

  // --- Monitoring (2) ---
  metrics?: ToolMetrics;
  traceId?: string;

  // --- B1: JSON Schema for LLM consumption ---
  toJSONSchema?: () => Record<string, unknown>;
}

// B1: Tool progress callback type
export type ToolProgressCallback<P> = (progress: P) => void;

// B1: Tool builder configuration (CCB-aligned)
export interface ToolBuilderConfig<I, O, P> {
  // Core
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema?: ZodType<O>;
  execute: (input: I, onProgress?: ToolProgressCallback<P>) => Promise<O>;

  // Registration & Discovery
  aliases?: string[];
  searchHint?: string;
  shouldDefer?: boolean;
  alwaysLoad?: boolean;
  isEnabled?: (ctx: { projectRoot: string; sessionId: string }) => boolean;
  toolGroup?: string;

  // Safety & Permissions
  isReadOnly?: boolean;
  isDestructive?: boolean;
  isConcurrencySafe?: boolean;
  validateInput?: (input: I) => { valid: boolean; error?: string };
  checkPermissions?: (input: I, ctx: { projectRoot: string; sessionId: string }) => { allowed: boolean; reason?: string };
  preparePermissionMatcher?: (input: I) => PermissionMatcher;
  interruptBehavior?: "allow" | "ignore" | "abort";

  // Output & Rendering
  maxResultSizeChars?: number;
  renderToolResultMessage?: (result: O) => string;
  renderToolUseMessage?: (input: I) => string;

  // Context
  prompt?: () => string | undefined;
  getPath?: (input: I) => string | undefined;

  // Execution Control
  timeout?: number;
  retryPolicy?: RetryPolicy;
}

// B1: Build a strongly-typed tool with Zod validation (CCB-aligned)
export function buildTool<I, O = unknown, P = unknown>(
  config: ToolBuilderConfig<I, O, P>
): ToolDefinition<I, O, P> & { toJSONSchema: () => Record<string, unknown> } {
  return {
    ...config,
    toJSONSchema() {
      return zodToJSONSchema(config.inputSchema, config.name, config.description);
    },
  };
}

// B1: Filter tools by deny rules (CCB-aligned)
export interface DenyRule {
  tool: string;
  args?: string;
}

export function filterToolsByDenyRules<T extends { name: string }>(
  tools: T[],
  denyRules: DenyRule[]
): T[] {
  return tools.filter(tool => {
    for (const rule of denyRules) {
      // Simple glob matching
      const regex = new RegExp("^" + rule.tool.replace(/\*/g, ".*") + "$");
      if (regex.test(tool.name)) {
        return false;
      }
    }
    return true;
  });
}

// B1: Convert Zod schema to JSON Schema for LLM
function zodToJSONSchema(schema: ZodType<unknown>, name: string, description: string): Record<string, unknown> {
  // Simplified conversion - in production would use zod-to-json-schema package
  const shape = (schema as unknown as { _def?: { shape?: Record<string, ZodType<unknown>> } })._def?.shape;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  if (shape) {
    for (const [key, value] of Object.entries(shape)) {
      const zodType = getZodType(value);
      properties[key] = {
        type: zodType,
        description: getZodDescription(value) || `${key} parameter`,
      };
      if (isZodRequired(value)) {
        required.push(key);
      }
    }
  }

  return {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
    },
  };
}

// B1: Helper to determine Zod type string
function getZodType(zodType: ZodType<unknown>): string {
  const def = (zodType as unknown as { _def?: { typeName?: string } })._def;
  const typeName = def?.typeName;

  switch (typeName) {
    case "ZodString": return "string";
    case "ZodNumber": return "number";
    case "ZodBoolean": return "boolean";
    case "ZodArray": return "array";
    case "ZodObject": return "object";
    default: return "string";
  }
}

// B1: Helper to get Zod description
function getZodDescription(zodType: ZodType<unknown>): string | undefined {
  const desc = (zodType as unknown as { description?: string }).description;
  return desc;
}

// B1: Helper to check if Zod field is required
function isZodRequired(zodType: ZodType<unknown>): boolean {
  // Zod fields are required by default unless wrapped in optional()
  const def = (zodType as unknown as { _def?: { typeName?: string } })._def;
  return def?.typeName !== "ZodOptional";
}

// Re-export Zod types for convenience
export type { ZodType, z };
