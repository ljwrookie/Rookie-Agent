import {
  Agent,
  AgentInput,
  AgentContext,
  AgentEvent,
  Message,
  ToolCall,
  ReActStep,
} from "./types.js";
import {
  ChatWithToolsParams,
  ToolDefinition,
} from "../models/types.js";
import { Tool } from "../tools/types.js";
import { RookieError, ErrorCode } from "../errors.js";
import { TokenTracker } from "../tracking.js";
import { Compactor } from "./compactor.js";
import { SkillLearner } from "../skills/learner.js";
import { CompletedTask } from "../skills/types.js";

const MAX_ITERATIONS = 15;

/**
 * Compact `messages` in place via the supplied Compactor. Returns an event to
 * emit if compaction happened, else null.
 *
 * Kept local to react.ts so we don't leak the AgentEvent shape into the
 * compactor module.
 */
async function maybeCompactInPlace(
  messages: Message[],
  compactor: Compactor,
): Promise<AgentEvent | null> {
  const result = await compactor.maybeCompact(messages);
  if (!result) return null;
  // Replace the array contents in place so the caller's reference stays valid.
  messages.splice(0, messages.length, ...result.messages);
  return {
    type: "compacted",
    reason: result.reason,
    before: result.before,
    after: result.after,
    summaryId: result.summaryId,
  };
}

/**
 * v2 ReAct loop (Phase 1):
 *   1. Inject ROOKIE.md instructions into system prompt
 *   2. Prefer native Function Calling (tool_calls in LLM response)
 *   3. Fall back to text-based Action parsing for models without FC support
 *   4. Use ToolRegistry.invoke() for permission + hook lifecycle
 *   5. Track token usage via TokenTracker
 *   6. Stream all responses by default
 */
export interface RunReActOptions {
  tokenTracker?: TokenTracker;
  skillLearner?: SkillLearner;
  onSkillProposed?: (candidate: {
    name: string;
    description: string;
    prompt: string;
    tools: string[];
  }) => Promise<boolean>;
}

export async function* runReAct(
  agent: Agent,
  input: AgentInput,
  context: AgentContext,
  options?: RunReActOptions
): AsyncGenerator<AgentEvent> {
  const steps: ReActStep[] = [];
  const tracker = options?.tokenTracker;
  const skillLearner = options?.skillLearner;
  const toolCalls: ToolCall[] = [];

  // ── Build system prompt with ROOKIE.md instructions ─────────
  let systemPrompt = agent.systemPrompt;
  if (context.instructions) {
    const instructions = context.instructions as { merged?: string };
    if (instructions.merged) {
      systemPrompt += "\n\n# Project Instructions (from ROOKIE.md)\n\n" + instructions.merged;
    }
  }

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    ...input.history,
    { role: "user", content: input.message },
  ];

  const useFC = context.model.capabilities?.functionCalling ?? false;
  const compactor = context.compactor instanceof Compactor ? context.compactor : undefined;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // P1-T3: compact before every model call when over threshold.
    if (compactor) {
      const evt = await maybeCompactInPlace(messages, compactor);
      if (evt) yield evt;
    }

    if (useFC) {
      yield* runFunctionCallingStep(agent, messages, steps, context, tracker);
    } else {
      yield* runTextParsingStep(agent, input, messages, steps, context, tracker);
    }

    const lastStep = steps[steps.length - 1];
    if (lastStep && !lastStep.action) {
      // Task completed - evaluate for skill creation (P2-T1)
      if (skillLearner) {
        yield* evaluateSkillCreation(skillLearner, input, steps, toolCalls, context, options);
      }
      return;
    }
  }

  yield { type: "error", error: "Max iterations reached" };

  // Even on max iterations, try skill evaluation
  if (skillLearner) {
    yield* evaluateSkillCreation(skillLearner, input, steps, toolCalls, context, options);
  }
}

// ─── Function Calling Path ─────────────────────────────────────

async function* runFunctionCallingStep(
  agent: Agent,
  messages: Message[],
  steps: ReActStep[],
  context: AgentContext,
  tracker?: TokenTracker
): AsyncGenerator<AgentEvent> {
  const toolDefs = buildToolDefinitions(agent, context);

  const params: ChatWithToolsParams = {
    messages,
    tools: toolDefs,
    toolChoice: "auto",
  };

  let textContent = "";
  const pendingToolCalls: Array<{ id: string; name: string; arguments: string }> = [];

  for await (const chunk of context.model.chatWithToolsStream(params)) {
    if (chunk.type === "text" && chunk.content) {
      textContent += chunk.content;
      yield { type: "response", content: chunk.content, done: false };
    }
    if (chunk.type === "tool_call" && chunk.toolCall) {
      pendingToolCalls.push(chunk.toolCall);
    }
    // Track token usage
    if (chunk.type === "done" && chunk.usage && tracker) {
      tracker.record(context.model.name, {
        promptTokens: chunk.usage.promptTokens,
        completionTokens: chunk.usage.completionTokens,
        totalTokens: chunk.usage.totalTokens,
      });
    }
  }

  if (pendingToolCalls.length > 0) {
    const assistantMsg: Message = {
      role: "assistant",
      content: textContent,
      toolCalls: pendingToolCalls.map((tc) => ({
        id: tc.id,
        name: tc.name,
        params: safeJsonParse(tc.arguments),
      })),
    };
    messages.push(assistantMsg);

    if (textContent) {
      yield { type: "thinking", content: textContent };
    }

    // Execute each tool call via ToolRegistry.invoke() (includes permission + hooks)
    for (const tc of pendingToolCalls) {
      const toolCall: ToolCall = {
        id: tc.id,
        name: tc.name,
        params: safeJsonParse(tc.arguments),
      };

      yield { type: "tool_call", call: toolCall };

      const startTime = Date.now();
      try {
        // Use registry.invoke() which includes permission check + hook lifecycle
        const output = await context.tools.invoke(tc.name, toolCall.params);
        const result = { id: tc.id, name: tc.name, output };
        const duration = Date.now() - startTime;
        yield { type: "tool_result", result, duration };

        steps.push({ thought: textContent, action: toolCall, observation: result.output });
        messages.push({ role: "tool", content: result.output, tool_call_id: tc.id });
      } catch (e) {
        const duration = Date.now() - startTime;

        if (e instanceof RookieError) {
          // Permission denied or hook rejected — report clearly
          const result = { id: tc.id, name: tc.name, output: "", error: e.message };
          yield { type: "tool_result", result, duration };

          if (e.code === ErrorCode.TOOL_PERMISSION_DENIED) {
            messages.push({ role: "tool", content: `[Permission Denied] ${e.message}`, tool_call_id: tc.id });
          } else if (e.code === ErrorCode.HOOK_REJECTED) {
            messages.push({ role: "tool", content: `[Hook Rejected] ${e.message}`, tool_call_id: tc.id });
            yield { type: "hook_fired", hook: "PreToolUse" };
          } else {
            messages.push({ role: "tool", content: `Error: ${e.message}`, tool_call_id: tc.id });
          }
        } else {
          const error = e instanceof Error ? e.message : String(e);
          const result = { id: tc.id, name: tc.name, output: "", error };
          yield { type: "tool_result", result, duration };
          messages.push({ role: "tool", content: `Error: ${error}`, tool_call_id: tc.id });
        }

        steps.push({
          thought: textContent,
          action: toolCall,
          observation: `Error: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    }
  } else {
    messages.push({ role: "assistant", content: textContent });
    steps.push({ thought: textContent });

    if (textContent) {
      yield { type: "response", content: "", done: true };
    }
  }
}

// ─── Text Parsing Fallback ─────────────────────────────────────

async function* runTextParsingStep(
  agent: Agent,
  input: AgentInput,
  messages: Message[],
  steps: ReActStep[],
  context: AgentContext,
  tracker?: TokenTracker
): AsyncGenerator<AgentEvent> {
  const prompt = buildReActPrompt(agent, input, steps);
  messages.push({ role: "user", content: prompt });

  let fullContent = "";
  for await (const chunk of context.model.chatStream({ messages })) {
    if (chunk.type === "text" && chunk.content) {
      fullContent += chunk.content;
    }
    if (chunk.type === "done" && chunk.usage && tracker) {
      tracker.record(context.model.name, {
        promptTokens: chunk.usage.promptTokens,
        completionTokens: chunk.usage.completionTokens,
        totalTokens: chunk.usage.totalTokens,
      });
    }
  }

  const thought = extractThought(fullContent);
  const action = extractAction(fullContent);

  const assistantMsg: Message = { role: "assistant", content: fullContent };
  if (action) {
    assistantMsg.toolCalls = [action];
  }
  messages.push(assistantMsg);

  if (thought) {
    yield { type: "thinking", content: thought };
    steps.push({ thought });
  }

  if (action) {
    yield { type: "tool_call", call: action };

    const startTime = Date.now();
    try {
      // Use registry.invoke() for permission + hook lifecycle
      const output = await context.tools.invoke(action.name, action.params);
      const result = { id: action.id, name: action.name, output };
      const duration = Date.now() - startTime;
      yield { type: "tool_result", result, duration };

      steps.push({ thought: thought || "", action, observation: result.output });
      messages.push({ role: "tool", content: `Result of ${action.name}: ${result.output}`, tool_call_id: action.id });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      const result = { id: action.id, name: action.name, output: "", error };
      const duration = Date.now() - startTime;
      yield { type: "tool_result", result, duration };

      steps.push({ thought: thought || "", action, observation: `Error: ${error}` });
      messages.push({ role: "tool", content: `Error executing ${action.name}: ${error}`, tool_call_id: action.id });
    }
  } else {
    yield { type: "response", content: fullContent.trim(), done: true };
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function buildToolDefinitions(agent: Agent, context: AgentContext): ToolDefinition[] {
  const defs: ToolDefinition[] = [];

  for (const toolName of agent.tools) {
    const tool: Tool | undefined = context.tools.get(toolName);
    if (!tool) continue;

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const p of tool.parameters) {
      properties[p.name] = { type: p.type, description: p.description };
      if (p.required !== false) {
        required.push(p.name);
      }
    }

    defs.push({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: { type: "object", properties, required },
      },
    });
  }

  return defs;
}

function buildReActPrompt(agent: Agent, input: AgentInput, steps: ReActStep[]): string {
  let prompt = `You are ${agent.name}: ${agent.description}\n\n`;
  prompt += `Available tools:\n`;
  for (const toolName of agent.tools) {
    prompt += `- ${toolName}\n`;
  }
  prompt += `\n`;

  if (steps.length > 0) {
    prompt += `Previous steps:\n`;
    for (const step of steps) {
      prompt += `Thought: ${step.thought}\n`;
      if (step.action) {
        prompt += `Action: ${step.action.name}(${JSON.stringify(step.action.params)})\n`;
      }
      if (step.observation) {
        prompt += `Observation: ${step.observation}\n`;
      }
      prompt += `\n`;
    }
  }

  prompt += `Respond in this format:\n`;
  prompt += `Thought: <your reasoning>\n`;
  prompt += `Action: <tool_name>({"param": "value"})  -- or --  Action: none\n`;
  prompt += `\nUser request: ${input.message}\n`;

  return prompt;
}

function extractThought(content: string): string | null {
  const match = content.match(/Thought:\s*(.+?)(?:\n|$)/i);
  return match?.[1]?.trim() || null;
}

function extractAction(content: string): ToolCall | null {
  const match = content.match(/Action:\s*(\w+)\((.*)\)/i);
  if (!match) return null;

  const name = match[1];
  const paramsStr = match[2].trim();

  let params: Record<string, unknown> = {};
  if (paramsStr && paramsStr !== "none") {
    try {
      params = JSON.parse(paramsStr);
    } catch {
      params = { raw: paramsStr };
    }
  }

  return { id: `call_${Date.now()}`, name, params };
}

function safeJsonParse(str: string): Record<string, unknown> {
  try {
    return JSON.parse(str);
  } catch {
    return { raw: str };
  }
}

// ─── Skill Creation Evaluation (P2-T1) ─────────────────────────

async function* evaluateSkillCreation(
  skillLearner: SkillLearner,
  input: AgentInput,
  steps: ReActStep[],
  toolCalls: ToolCall[],
  context: AgentContext,
  options?: RunReActOptions
): AsyncGenerator<AgentEvent> {
  const completedTask: CompletedTask = {
    id: `task_${Date.now()}`,
    description: input.message.slice(0, 100),
    messages: steps.map((s) => ({
      role: s.action ? "assistant" : "user",
      content: s.thought || "",
    })),
    tools_used: toolCalls.map((tc) => tc.name),
    success: !steps.some((s) => s.observation?.includes("Error")),
  };

  const candidate = await skillLearner.evaluateForCreation(completedTask);
  if (!candidate) return;

  // Fire OnSkillProposed hook if hooks are available
  if (context.hooks) {
    const hookCtx: import("../hooks/types.js").HookContext = {
      sessionId: context.sessionId || "default",
      projectRoot: context.projectRoot || process.cwd(),
      skillProposal: {
        candidate: {
          name: candidate.name,
          description: candidate.description,
          prompt: candidate.prompt,
          tools: candidate.tools,
        },
        approved: undefined,
      },
    };

    const results = await context.hooks.fire("OnSkillProposed", hookCtx);

    // Check if any hook approved
    const approved = results.some((r) =>
      r.output?.toLowerCase().includes("approve") ||
      r.output?.toLowerCase().includes("yes")
    );

    if (approved || options?.onSkillProposed) {
      const userApproved = options?.onSkillProposed
        ? await options.onSkillProposed(candidate)
        : true;

      if (userApproved) {
        await skillLearner.createSkill(candidate);
        yield {
          type: "system_message" as const,
          content: `💡 Created skill: ${candidate.name} — ${candidate.description}`,
        };
      }
    }
  }
}
