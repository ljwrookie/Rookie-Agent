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

// B1: New structured Tool definition with generics
export interface ToolDefinition<I = unknown, O = unknown, P = unknown> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema?: ZodType<O>;
  execute: (input: I, onProgress?: (progress: P) => void) => Promise<O>;
  isReadOnly?: boolean;
  isConcurrencySafe?: boolean;
  // B1: JSON Schema for LLM consumption
  toJSONSchema?: () => Record<string, unknown>;
}

// B1: Tool progress callback type
export type ToolProgressCallback<P> = (progress: P) => void;

// B1: Tool builder configuration
export interface ToolBuilderConfig<I, O, P> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  outputSchema?: ZodType<O>;
  execute: (input: I, onProgress?: ToolProgressCallback<P>) => Promise<O>;
  isReadOnly?: boolean;
  isConcurrencySafe?: boolean;
}

// B1: Build a strongly-typed tool with Zod validation
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
