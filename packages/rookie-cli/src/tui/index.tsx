// ─── TUI Entry Point ─────────────────────────────────────────────
// Fixes: #2 AbortController, #3 Approval blocking, #13 Token tracking

import { render } from "ink";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { App } from "./app.js";
import { ThemeProvider } from "./hooks/useTheme.js";
import {
  CoderAgent,
  ToolRegistry,
  MemoryStore,
  ModelRouter,
  StdioTransport,
  RookieClient,
  OpenAIProvider,
  AnthropicProvider,
  ConfigManager,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  shellExecuteTool,
  searchCodeTool,
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  gitBranchTool,
  gitLogTool,
  gitCheckoutTool,
  editApplyDiffTool,
  editAtomicWriteTool,
  globFilesTool,
  grepFilesTool,
  webFetchTool,
  webSearchTool,
  agentTool,
  createAskUserQuestionTool,
  skillTool,
  planModeTool,
  sleepTool,
  todoWriteTool,
  notebookReadTool,
  notebookEditTool,
  briefTool,
  listMcpResourcesTool,
  readMcpResourceTool,
  taskCreateTool,
  taskUpdateTool,
  taskListTool,
  taskGetTool,
  taskOutputTool,
  resolveCoreBinary,
  HookRegistry,
  InstructionLoader,
  PermissionManager,
  TokenTracker,
  AutoMemory,
  loadSettings,
  createDefaultRegistry,
  SkillRegistry,
  Compactor,
} from "@rookie/agent-sdk";
import type {
  AgentEvent,
  OrchestratorEvent,
  AskDecision,
  Message,
  PermissionRule,
  RememberScope,
} from "@rookie/agent-sdk";

function enterAltScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\u001b[?1049h\u001b[H\u001b[2J\u001b[?25l");
}

function exitAltScreen() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\u001b[?25h\u001b[?1049l");
}

export interface TuiCodeModeOptions {
  record?: boolean;
}

export async function startTuiCodeMode(options: TuiCodeModeOptions = {}): Promise<void> {
  const configManager = new ConfigManager();
  const fileConfig = await configManager.load();
  const envConfig = ConfigManager.fromEnv();

  const config = {
    models: envConfig.models.length > 0 ? envConfig.models : fileConfig.models,
    apiKeys: { ...fileConfig.apiKeys, ...envConfig.apiKeys },
    defaultModel: envConfig.defaultModel || fileConfig.defaultModel,
  };

  const transport = new StdioTransport({
    command: resolveCoreBinary(),
    args: [],
  });
  await transport.start();

  const client = new RookieClient(transport);
  const sessionId = `sess_${Math.random().toString(16).slice(2, 12)}`;
  const projectRoot = process.cwd();

  const permissions = new PermissionManager();
  const hooks = new HookRegistry();
  const tokenTracker = new TokenTracker();
  const instructionLoader = new InstructionLoader();
  const instructions = await instructionLoader.load(projectRoot);

  // P0-T4 / P1-T1: Persist `forever` approvals into .rookie/settings.local.json so
  // subsequent runs auto-allow the same tool without prompting again. We load the
  // full three-tier merged view so project/global settings (permissions, hooks,
  // logging) also flow in.
  const settingsLocalPath = path.join(projectRoot, ".rookie", "settings.local.json");
  async function readLocalSettings(): Promise<Record<string, unknown>> {
    try {
      const raw = await fs.readFile(settingsLocalPath, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  async function writeLocalSettings(data: Record<string, unknown>): Promise<void> {
    await fs.mkdir(path.dirname(settingsLocalPath), { recursive: true });
    await fs.writeFile(settingsLocalPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }
  permissions.onPersist(async (rule: PermissionRule, _scope: RememberScope) => {
    const settings = await readLocalSettings();
    const existing = (settings.permissions as PermissionRule[] | undefined) ?? [];
    const key = `${rule.tool}::${rule.args ?? ""}`;
    const filtered = existing.filter(
      (r) => `${r.tool}::${r.args ?? ""}` !== key,
    );
    filtered.unshift(rule);
    settings.permissions = filtered;
    await writeLocalSettings(settings);
  });

  // #2: AbortController for interrupt support
  let currentAbort: AbortController | null = null;

  // #3: Approval bridge — maps tool call to a Promise the TUI resolves
  let pendingApprovalResolve: ((decision: AskDecision) => void) | null = null;

  // B10.2: User question bridge — maps question to a Promise the TUI resolves
  let pendingQuestionResolve: ((answer: string) => void) | null = null;

  const tools = new ToolRegistry({
    permissions,
    hooks,
    sessionId,
    projectRoot,
    // #3 / P0-T4: Block on TUI approval for dangerous tools, and surface the
    // user's `once / session / forever` choice back to the permission manager.
    onAskPermission: async (toolName, _params) => {
      const dangerous = new Set(["shell_execute", "file_write", "file_edit"]);
      if (!dangerous.has(toolName)) return { allowed: true };

      return new Promise<AskDecision>((resolve) => {
        pendingApprovalResolve = resolve;
      });
    },
  });

  // Merge global + project + local and push the result into permissions/hooks.
  // Also wire MCP server configs into the tool registry (B10.7).
  try {
    const { merged } = await loadSettings({ projectRoot });
    permissions.loadFromSettings(merged);
    hooks.loadFromSettings(merged);
    // MCP servers are optional; bootstrap will no-op when empty.
    if ((merged as any)?.mcpServers) {
      tools.setOptions({ mcpServers: (merged as any).mcpServers });
    }
  } catch {
    // non-fatal: treat as empty settings
  }

  // P2.1: Full tool registry — register all SDK builtin tools
  tools.register(fileReadTool);
  tools.register(fileWriteTool);
  tools.register(fileEditTool);
  tools.register(shellExecuteTool);
  tools.register(searchCodeTool);
  tools.register(gitStatusTool);
  tools.register(gitDiffTool);
  tools.register(gitCommitTool);
  tools.register(gitBranchTool);
  tools.register(gitLogTool);
  tools.register(gitCheckoutTool);
  tools.register(editApplyDiffTool);
  tools.register(editAtomicWriteTool);
  tools.register(globFilesTool);
  tools.register(grepFilesTool);
  tools.register(webFetchTool);
  tools.register(webSearchTool);
  tools.register(agentTool);
  // B10.2: Register TUI-aware AskUserQuestion tool that bridges to the panel
  tools.register(createAskUserQuestionTool({
    askUser: async (_question: string, _options?: string[]): Promise<string> => {
      return new Promise<string>((resolve) => {
        pendingQuestionResolve = resolve;
      });
    },
  }));
  tools.register(skillTool);
  tools.register(planModeTool);
  tools.register(sleepTool);
  tools.register(todoWriteTool);
  tools.register(notebookReadTool);
  tools.register(notebookEditTool);
  tools.register(briefTool);
  tools.register(listMcpResourcesTool);
  tools.register(readMcpResourceTool);
  tools.register(taskCreateTool);
  tools.register(taskUpdateTool);
  tools.register(taskListTool);
  tools.register(taskGetTool);
  tools.register(taskOutputTool);

  // B10.7: Bootstrap MCP servers and auto-register their tools.
  try {
    const res = await tools.bootstrap();
    if (res.errors.length > 0) {
      console.warn("MCP bootstrap warnings:", res.errors);
    }
  } catch (e) {
    console.warn("MCP bootstrap failed:", e);
  }

  const memory = new MemoryStore();
  const autoMemory = new AutoMemory(memory);

  const router = new ModelRouter();

  for (const model of config.models) {
    const apiKey = config.apiKeys[model.provider] || config.apiKeys["openai"];
    if (!apiKey) continue;

    if (model.provider === "openai" || model.provider === "ark") {
      router.register(model.name, new OpenAIProvider({
        apiKey,
        baseUrl: model.baseURL,
        model: model.name,
      }));
    } else if (model.provider === "anthropic") {
      router.register(model.name, new AnthropicProvider({
        apiKey,
        baseUrl: model.baseURL,
        model: model.name,
      }));
    }
  }

  if (router.listProviders().length === 0) {
    router.register("mock", {
      name: "mock",
      capabilities: { streaming: false, functionCalling: false, vision: false, maxTokens: 4096, contextWindow: 8192 },
      chat: async () => ({
        content: "Mock response. Set ARK_API_KEY or OPENAI_API_KEY for real LLM responses.",
      }),
      chatStream: async function* () { yield { type: "text" as const, content: "Mock. Set an API key." }; yield { type: "done" as const }; },
      chatWithToolsStream: async function* () { yield { type: "text" as const, content: "Mock. Set an API key." }; yield { type: "done" as const }; },
    } as any);
  }

  let gitBranch: string | undefined;
  try {
    const { execSync } = await import("child_process");
    gitBranch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: projectRoot,
      timeout: 3000,
    }).toString().trim();
  } catch {
    // Not a git repo
  }

  await hooks.fire("SessionStart", { sessionId, projectRoot });

  const agentContext = {
    client,
    model: router.getDefault(),
    memory,
    tools,
    hooks,
    instructions,
    permissions,
    // P1-T3: wire an auto-compactor so `runReAct` trims history before every
    // model call once tokens exceed 80% of the window.
    compactor: new Compactor({
      contextWindow: router.getDefault().capabilities?.contextWindow ?? 8192,
      triggerRatio: 0.8,
      keepRecent: 10,
      memory,
      hooks,
      sessionId,
      projectRoot,
    }),
    // B10.2: Bridge user questions to TUI
    onAskUser: async (_question: string, _options?: string[], _defaultValue?: string): Promise<string> => {
      return new Promise<string>((resolve) => {
        pendingQuestionResolve = resolve;
      });
    },
  };

  const agent = new CoderAgent();
  const startedAt = Date.now();
  const modelName = router.getDefault().name;
  const toolNames = tools.list().map((t) => t.name);

  // P4.4: Initialize transcript recording if --record flag is set
  if (options.record) {
    try {
      const { initTranscriptManager } = await import("@rookie/agent-sdk");
      await initTranscriptManager({ sessionId, projectRoot });
    } catch {
      // Non-fatal: transcript recording is best-effort
    }
  }

  // #2: handleMessage with AbortSignal support
  async function* handleMessage(message: string, signal?: AbortSignal): AsyncGenerator<AgentEvent | OrchestratorEvent> {
    const history: Message[] = [];
    try {
      const loaded = await memory.load("code-session");
      history.push(...loaded);
    } catch {
      // no previous session
    }

    const input = { message, history };
    const assistantResponses: string[] = [];
    // P4.2: Collect tool calls and results for complete session persistence
    const sessionToolCalls: import("@rookie/agent-sdk").ToolCall[] = [];
    const sessionToolResults: import("@rookie/agent-sdk").ToolResult[] = [];

    for await (const event of agent.run(input, agentContext)) {
      // #2: Check abort signal
      if (signal?.aborted) {
        yield { type: "error", error: "Interrupted by user" };
        return;
      }

      await autoMemory.evaluate(event);

      // #13: Track token usage
      if (event.type === "response" && event.done) {
        // Token tracking happens inside the agent; we just expose the tracker
      }

      // FIX #4: Collect assistant responses for persistence
      if (event.type === "response" && event.content) {
        assistantResponses.push(event.content);
      }

      // P4.2: Capture tool calls and results for complete session memory
      if (event.type === "tool_call") {
        const e = event as any;
        if (e.call) sessionToolCalls.push(e.call);
      }
      if (event.type === "tool_result") {
        const e = event as any;
        if (e.result) sessionToolResults.push(e.result);
      }

      yield event;
    }

    // P4.2: Persist complete session history including tool calls and results
    const sessionHistory: Message[] = [...history];

    // Add user message
    sessionHistory.push({ role: "user", content: message });

    // Add assistant response with any tool calls
    if (assistantResponses.length > 0 || sessionToolCalls.length > 0) {
      const assistantMsg: Message = {
        role: "assistant",
        content: assistantResponses.join(""),
      };
      if (sessionToolCalls.length > 0) {
        assistantMsg.toolCalls = sessionToolCalls;
      }
      sessionHistory.push(assistantMsg);
    }

    // Add tool results as separate messages (OpenAI-style function results)
    for (const result of sessionToolResults) {
      sessionHistory.push({
        role: "tool",
        content: result.output,
        tool_call_id: result.id,
      } as Message);
    }

    await memory.save("code-session", sessionHistory);
  }

  // Wrapper that creates AbortController per message
  function createMessageHandler() {
    return (message: string): { generator: AsyncGenerator<AgentEvent | OrchestratorEvent>; abort: () => void } => {
      currentAbort = new AbortController();
      const gen = handleMessage(message, currentAbort.signal);
      return {
        generator: gen,
        abort: () => { currentAbort?.abort(); },
      };
    };
  }

  enterAltScreen();
  // P1-T2: Build the slash-command registry (defaults + SKILL.md contributions)
  // once at boot so the TUI and any future non-interactive callers share the
  // same source of truth. Skill loading is best-effort; failures should not
  // block the TUI.
  const commands = createDefaultRegistry();
  try {
    const skills = new SkillRegistry({
      storageDir: path.join(projectRoot, ".rookie", "skills"),
    });
    await skills.loadAll(projectRoot);
    commands.registerSkills(skills.list());
  } catch {
    // Non-fatal: no skills directory or parse error — continue with builtins.
  }

  // P1-T3: override /compact with a TUI-scoped handler so the user can force
  // a compaction against the persisted session history. The builtin falls back
  // to an informational message when no forcer is wired.
  const compactor = (agentContext as { compactor: Compactor }).compactor;
  commands.register({
    name: "compact",
    description: "Force-compact the conversation context",
    usage: "/compact",
    category: "workflow",
    source: "builtin",
    handler: async () => {
      try {
        const history = await memory.load("code-session");
        const result = await compactor.forceCompact(history);
        await memory.save("code-session", result.messages);
        return {
          systemMessage:
            `Compacted: messages ${result.before.messages} → ${result.after.messages}, ` +
            `tokens ${result.before.tokens} → ${result.after.tokens}` +
            (result.summaryId ? ` (summary: ${result.summaryId})` : "") +
            ".",
        };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return { systemMessage: `Compaction failed: ${err}` };
      }
    },
  });

  const { waitUntilExit } = render(
    <ThemeProvider>
      <App
        onMessage={createMessageHandler()}
        onApprovalResponse={(allowed: boolean, remember?: "once" | "session" | "forever") => {
          if (pendingApprovalResolve) {
            pendingApprovalResolve({ allowed, remember: remember ?? "once" });
            pendingApprovalResolve = null;
          }
        }}
        onInterrupt={() => {
          currentAbort?.abort();
        }}
        onQuestionResponse={(answer: string) => {
          if (pendingQuestionResolve) {
            pendingQuestionResolve(answer);
            pendingQuestionResolve = null;
          }
        }}
        tokenTracker={tokenTracker}
        commands={commands}
        modelRouter={router}
        memoryStore={memory}
        meta={{
          sessionId,
          startedAt,
          modelName,
          mode: "code",
          toolNames,
          version: process.env.ROOKIE_CLI_VERSION,
          gitBranch,
        }}
      />
    </ThemeProvider>
  );

  try {
    await waitUntilExit();
  } finally {
    await hooks.fire("SessionEnd", { sessionId, projectRoot });
    await autoMemory.flushSession();
    exitAltScreen();
    await transport.stop();
    await memory.close();
  }
}
