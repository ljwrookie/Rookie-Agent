// ─── Skill Tool ──────────────────────────────────────────────────
// B10.3: Execute a registered skill by name

import { Tool } from "../types.js";
import { SkillRegistry } from "../../skills/registry.js";

interface SkillToolParams {
  skill: string;
  args?: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export function createSkillTool(options: {
  skillRegistry: SkillRegistry;
  defaultContext?: Record<string, unknown>;
}): Tool {
  return {
    name: "Skill",
    description:
      "Execute a registered skill by name. " +
      "Skills are reusable, parameterized workflows for common tasks. " +
      "Use this to invoke pre-defined patterns like 'commit', 'review', 'refactor', etc.",
    parameters: [
      {
        name: "skill",
        type: "string",
        description: "Name of the skill to execute (e.g., 'commit', 'review', 'test')",
        required: true,
      },
      {
        name: "args",
        type: "object",
        description: "Arguments to pass to the skill (skill-specific)",
        required: false,
      },
      {
        name: "context",
        type: "object",
        description: "Additional context to provide to the skill",
        required: false,
      },
    ],
    isReadOnly: false,
    isConcurrencySafe: true,
    async execute(params: Record<string, unknown>): Promise<string> {
      const config: SkillToolParams = {
        skill: String(params.skill),
        args: (params.args as Record<string, unknown>) || {},
        context: (params.context as Record<string, unknown>) || {},
      };

      if (!config.skill.trim()) {
        return "[ERROR] Skill name cannot be empty";
      }

      const skill = options.skillRegistry.get(config.skill);
      if (!skill) {
        const available = options.skillRegistry.list().map(s => s.name).join(", ");
        return `[ERROR] Skill "${config.skill}" not found. Available: ${available || "none"}`;
      }

      try {
        const startTime = Date.now();

        // Merge default context with provided context
        const mergedContext = {
          ...options.defaultContext,
          ...config.context,
        };

// Execute the skill by running its prompt through the model
        // In a real implementation, this would use the model provider
        // mergedContext is reserved for future use
        void mergedContext;
        const result = `Skill "${config.skill}" executed with args: ${JSON.stringify(config.args)}`;

        const durationMs = Date.now() - startTime;

        return formatSkillResult(config.skill, result, durationMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `[ERROR] Skill "${config.skill}" execution failed: ${message}`;
      }
    },
  };
}

function formatSkillResult(skillName: string, result: unknown, durationMs: number): string {
  const lines: string[] = [
    `Skill: ${skillName}`,
    `Duration: ${formatDuration(durationMs)}`,
    "",
    "Result:",
  ];

  if (typeof result === "string") {
    lines.push(result);
  } else {
    lines.push(JSON.stringify(result, null, 2));
  }

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

// Placeholder skill tool - requires SkillRegistry to be provided
export const skillTool: Tool = {
  name: "Skill",
  description:
    "Execute a registered skill by name. " +
    "Skills are reusable, parameterized workflows for common tasks.",
  parameters: [
    { name: "skill", type: "string", description: "Name of the skill to execute", required: true },
    { name: "args", type: "object", description: "Arguments for the skill", required: false },
  ],
  async execute() {
    return "[ERROR] Skill tool requires a SkillRegistry to be configured. Use createSkillTool() to create a configured instance.";
  },
};
