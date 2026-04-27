// ─── Agent Tool ──────────────────────────────────────────────────
// B10.1: Launch subagent for complex multi-step tasks

import { Tool } from "../types.js";
import { SubagentConfig } from "../../agent/subagent.js";

interface AgentToolParams {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
  timeout?: number;
  maxIterations?: number;
}

interface AgentToolResult {
  success: boolean;
  result: string;
  iterations: number;
  toolsUsed: string[];
  durationMs: number;
}

export function createAgentTool(options: {
  defaultModel?: string;
  maxConcurrent?: number;
  registry?: unknown;
} = {}): Tool {
  return {
    name: "Agent",
    description:
      "Launch a subagent to handle complex, multi-step tasks autonomously. " +
      "The subagent has its own tool registry and can execute tools in parallel. " +
      "Use this for tasks that require exploration, research, or multiple tool calls.",
    parameters: [
      {
        name: "description",
        type: "string",
        description: "Short description of what the subagent should do (1-2 sentences)",
        required: true,
      },
      {
        name: "prompt",
        type: "string",
        description: "Full prompt/instructions for the subagent",
        required: true,
      },
      {
        name: "tools",
        type: "array",
        description: "List of tool names the subagent can use (default: all read-only tools)",
        required: false,
      },
      {
        name: "model",
        type: "string",
        description: "Model to use for the subagent (default: same as parent)",
        required: false,
      },
      {
        name: "timeout",
        type: "number",
        description: "Timeout in milliseconds (default: 120000)",
        required: false,
      },
      {
        name: "max_iterations",
        type: "number",
        description: "Maximum ReAct iterations (default: 10)",
        required: false,
      },
    ],
    isReadOnly: false,
    isConcurrencySafe: false,
    async execute(params: Record<string, unknown>): Promise<string> {
      const config: AgentToolParams = {
        description: String(params.description),
        prompt: String(params.prompt),
        tools: Array.isArray(params.tools) ? params.tools.map(String) : undefined,
        model: params.model ? String(params.model) : options.defaultModel,
        timeout: typeof params.timeout === "number" ? params.timeout : 120000,
        maxIterations: typeof params.max_iterations === "number" ? params.max_iterations : 10,
      };

      const startTime = Date.now();
      const taskId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      try {
  // Create subagent configuration
        const subagentConfig: SubagentConfig = {
          name: taskId,
          agent: {
            name: "subagent",
            description: config.description,
            systemPrompt: config.prompt,
            tools: config.tools || ["file_read", "glob_files", "grep_files", "search_code"],
            run: async function* () {
              // Placeholder - real implementation would run the agent
              yield { type: "response" as const, content: "Subagent execution completed", done: true };
            },
          },
          model: config.model,
          timeout: config.timeout,
          contextMode: "fork",
        };

// Execute subagent task
        const result = await executeSubagentTask(subagentConfig, config.maxIterations);

        const durationMs = Date.now() - startTime;

        return formatAgentResult({
          success: result.success,
          result: result.output,
          iterations: result.iterations,
          toolsUsed: result.toolsUsed,
          durationMs,
        });
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const message = error instanceof Error ? error.message : String(error);

        return formatAgentResult({
          success: false,
          result: `Subagent failed: ${message}`,
          iterations: 0,
          toolsUsed: [],
          durationMs,
        });
      }
    },
  };
}

async function executeSubagentTask(
  config: SubagentConfig,
  maxIterations?: number,
): Promise<{
  success: boolean;
  output: string;
  iterations: number;
  toolsUsed: string[];
}> {
  // This is a simplified implementation
  // In production, this would integrate with the actual SubagentManager

  const toolsUsed: string[] = [];
  let iterations = 0;
  // maxIterations parameter reserved for future use
  void maxIterations;

  // Simulate subagent execution
  // In real implementation, this would:
  // 1. Create a new agent instance with limited tool registry
  // 2. Run ReAct loop with the prompt
  // 3. Collect results and return

  return {
    success: true,
    output: `Subagent completed task: ${config.name}`,
    iterations,
    toolsUsed,
  };
}

function formatAgentResult(result: AgentToolResult): string {
  const lines: string[] = [
    `Subagent Result: ${result.success ? "✓ Success" : "✗ Failed"}`,
    `Duration: ${formatDuration(result.durationMs)}`,
    `Iterations: ${result.iterations}`,
    `Tools used: ${result.toolsUsed.length > 0 ? result.toolsUsed.join(", ") : "none"}`,
    "",
    "Result:",
    result.result,
  ];

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

export const agentTool: Tool = createAgentTool();
