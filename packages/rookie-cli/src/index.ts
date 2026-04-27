#!/usr/bin/env node

import { Command } from "commander";
import {
  StdioTransport,
  SkillRegistry,
  AgentOrchestrator,
  CoderAgent,
  ExplorerAgent,
  resolveCoreBinary,
} from "@rookie/agent-sdk";
// repl.ts deleted - using TUI mode only
import { startCodeMode } from "./commands/code.js";
import { runInit } from "./commands/init.js";
import { runResume } from "./commands/resume.js";
import { runProgress } from "./commands/progress.js";
import { runVerify } from "./commands/verify.js";
import { runHookList, runHookAdd, runHookTest, runHookRemove } from "./commands/hook.js";
import { runPermList, runPermSet, runPermMove } from "./commands/permission.js";
import { runConfigShow } from "./commands/config.js";
import { doctorCommand } from "./commands/doctor.js";
import { updateCommand, versionCommand } from "./commands/update.js";
import { runMemoryShow } from "./commands/memory.js";

const program = new Command();

program
  .name("rookie")
  .description("Rookie Agent - All-in-one AI Agent")
  .version("0.1.0");

// ── Prompt flag for pipe support ────────────────────────
// Usage: echo "fix the bug" | rookie -p
// Usage: rookie -p "explain this code"
program
  .option("-p, --prompt [text]", "Run a single prompt (reads from stdin if no text given)")
  .option("-o, --output-format <format>", "Output format: text | json | stream-json", "text")
  .option("--model <model>", "Model to use (e.g. gpt-4o, claude-sonnet-4)")
  .option("--agent <agent>", "Agent to use: coder | explorer | reviewer | architect", "coder");

program
  .command("chat")
  .description("Start interactive chat")
  .action(async () => {
    const transport = new StdioTransport({
      command: resolveCoreBinary(),
      args: [],
    });

    await transport.start();
    console.log("Rookie Agent started. Type 'exit' to quit.");

    const readline = await import("readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const ask = () => {
      rl.question("> ", async (input) => {
        if (input.trim() === "exit") {
          await transport.stop();
          rl.close();
          return;
        }

        console.log(`You said: ${input}`);
        ask();
      });
    };

    ask();
  });

program
  .command("code")
  .description("Start coding assistant mode")
  .action(async () => {
    await startCodeMode();
  });

program
  .command("index")
  .description("Build project index")
  .argument("[root]", "Project root directory", ".")
  .action(async (root: string) => {
    const transport = new StdioTransport({
      command: resolveCoreBinary(),
      args: [],
    });

    await transport.start();

    const { RookieClient } = await import("@rookie/agent-sdk");
    const client = new RookieClient(transport);

    try {
      const result = await client.index.build(root);
      console.log(`Indexed ${result.file_count} files`);
    } catch (e) {
      console.error("Failed to build index:", e);
    }

    await transport.stop();
  });

program
  .command("search")
  .description("Search code")
  .argument("<query>", "Search query")
  .option("-l, --limit <number>", "Result limit", "10")
  .action(async (query: string, options: { limit: string }) => {
    const transport = new StdioTransport({
      command: resolveCoreBinary(),
      args: [],
    });

    await transport.start();

    const { RookieClient } = await import("@rookie/agent-sdk");
    const client = new RookieClient(transport);

    try {
      const result = await client.index.search(query, parseInt(options.limit, 10));
      for (const item of result.results) {
        console.log(`${(item as any).path} (${(item as any).score})`);
        console.log(`  ${(item as any).snippet?.slice(0, 100)}...`);
      }
    } catch (e) {
      console.error("Search failed:", e);
    }

    await transport.stop();
  });

// ── Skill management commands ───────────────────────────

program
  .command("skill")
  .description("Manage skills")
  .addCommand(
    new Command("list")
      .description("List all installed skills")
      .action(async () => {
        const registry = new SkillRegistry();
        await registry.loadFromDisk();
        const skills = registry.list();
        if (skills.length === 0) {
          console.log("No skills installed.");
          return;
        }
        console.log("Installed skills:");
        for (const skill of skills) {
          console.log(`  ${skill.name} v${skill.version} - ${skill.description}`);
        }
      })
  )
  .addCommand(
    new Command("import")
      .description("Import a skill from URL or file")
      .argument("<url>", "URL or file path to skill")
      .action(async (url: string) => {
        const registry = new SkillRegistry();
        await registry.loadFromDisk();
        try {
          const skill = await registry.importFromUrl(url);
          console.log(`Imported skill: ${skill.name} v${skill.version}`);
        } catch (e) {
          console.error("Failed to import skill:", e);
        }
      })
  )
  .addCommand(
    new Command("export")
      .description("Export a skill to JSON")
      .argument("<name>", "Skill name")
      .action(async (name: string) => {
        const registry = new SkillRegistry();
        await registry.loadFromDisk();
        try {
          const json = await registry.exportSkill(name);
          console.log(json);
        } catch (e) {
          console.error("Failed to export skill:", e);
        }
      })
  );

// ── Agent management commands ───────────────────────────

program
  .command("agent")
  .description("Manage agents")
  .addCommand(
    new Command("list")
      .description("List available agents")
      .action(() => {
        console.log("Available agents:");
        console.log("  coder      - Coding assistant (read, write, edit, test)");
        console.log("  explorer   - Code explorer (search, navigate, analyze)");
        console.log("  reviewer   - Code reviewer (diff, quality, best practices)");
        console.log("  architect  - System architect (design, plan, evaluate)");
      })
  )
  .addCommand(
    new Command("run")
      .description("Run an agent with a task")
      .argument("<name>", "Agent name")
      .argument("<task>", "Task description")
      .action(async (name: string, task: string) => {
        await runAgentTask(name, task);
      })
  )
  .addCommand(
    new Command("pipeline")
      .description("Run a pipeline of agents sequentially")
      .argument("<agents...>", "Agent names in order")
      .option("-t, --task <task>", "Task description", "Explore and modify code")
      .action(async (agentNames: string[], options: { task: string }) => {
        await runAgentPipeline(agentNames, options.task);
      })
  )
  .addCommand(
    new Command("parallel")
      .description("Run agents in parallel and synthesize results")
      .argument("<agents...>", "Agent names")
      .option("-t, --task <task>", "Task description", "Analyze code")
      .action(async (agentNames: string[], options: { task: string }) => {
        await runAgentParallel(agentNames, options.task);
      })
  );

// ── Session harness commands ────────────────────────────

program
  .command("init")
  .description("Initialize a Harness session (Phase 1): task decomposition + progress file")
  .option("--task <text>", "Task description (required)")
  .option("--features-file <path>", "JSON file containing an array of features")
  .option("--verify <cmd>", "Global verify command (e.g. 'npm test')")
  .option("--cwd <path>", "Project root", process.cwd())
  .action(async (opts: { task?: string; featuresFile?: string; verify?: string; cwd?: string }) => {
    const code = await runInit({
      projectRoot: opts.cwd,
      task: opts.task,
      featuresFile: opts.featuresFile,
      verifyCommand: opts.verify,
    });
    process.exit(code);
  });

program
  .command("resume")
  .description("Resume a Harness session (Phase 2): re-hydrate progress from disk")
  .option("--session-id <id>", "Explicit session id (else auto-generated)")
  .option("--cwd <path>", "Project root", process.cwd())
  .action(async (opts: { sessionId?: string; cwd?: string }) => {
    const code = await runResume({ projectRoot: opts.cwd, sessionId: opts.sessionId });
    process.exit(code);
  });

program
  .command("progress")
  .description("Render .rookie/progress.md (or JSON snapshot with features)")
  .option("--format <fmt>", "markdown | json", "markdown")
  .option("--cwd <path>", "Project root", process.cwd())
  .action(async (opts: { format?: string; cwd?: string }) => {
    const fmt = opts.format === "json" ? "json" : "markdown";
    const code = await runProgress({ projectRoot: opts.cwd, format: fmt });
    process.exit(code);
  });

program
  .command("verify")
  .description("Run verifyCommand for every (or a single) feature")
  .option("--feature <id>", "Verify only this feature id")
  .option("--bail", "Stop on first failure", false)
  .option("--cwd <path>", "Project root", process.cwd())
  .action(async (opts: { feature?: string; bail?: boolean; cwd?: string }) => {
    const code = await runVerify({
      projectRoot: opts.cwd,
      featureId: opts.feature,
      bail: opts.bail,
    });
    process.exit(code);
  });

// ── Hook management ─────────────────────────────────────

program
  .command("hook")
  .description("Manage lifecycle hooks stored in .rookie/settings(.local).json")
  .addCommand(
    new Command("list")
      .description("List registered hooks")
      .option("--scope <scope>", "local | project", "local")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: { scope?: string; cwd?: string }) => {
        const code = await runHookList({ projectRoot: opts.cwd, scope: opts.scope === "project" ? "project" : "local" });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command("add")
      .description("Add a hook (shell | http | llm)")
      .requiredOption("--event <event>", "PreToolUse | PostToolUse | SessionStart | ...")
      .option("--command <cmd>", "Shell command")
      .option("--url <url>", "HTTP webhook")
      .option("--prompt <prompt>", "LLM prompt")
      .option("--matcher <pattern>", "Tool name pattern (e.g. file_*)")
      .option("--can-reject", "Allow this pre-hook to cancel the tool call")
      .option("--blocking", "Block until hook resolves (default true)")
      .option("--timeout <ms>", "Timeout in ms", (v) => parseInt(v, 10))
      .option("--scope <scope>", "local | project", "local")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: Record<string, unknown>) => {
        const code = await runHookAdd({
          projectRoot: opts.cwd as string,
          scope: opts.scope === "project" ? "project" : "local",
          event: opts.event as string,
          command: opts.command as string | undefined,
          url: opts.url as string | undefined,
          prompt: opts.prompt as string | undefined,
          matcher: opts.matcher as string | undefined,
          canReject: Boolean(opts.canReject),
          blocking: opts.blocking === undefined ? undefined : Boolean(opts.blocking),
          timeout: opts.timeout as number | undefined,
        });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command("test")
      .description("Fire a hook event once and print each result")
      .requiredOption("--event <event>", "Event name")
      .option("--tool <name>", "Tool name (for *ToolUse events)")
      .option("--input <json>", "Tool input JSON")
      .option("--scope <scope>", "local | project", "local")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: Record<string, unknown>) => {
        let toolInput: Record<string, unknown> | undefined;
        if (typeof opts.input === "string") {
          try { toolInput = JSON.parse(opts.input as string); }
          catch { console.error("Error: --input must be valid JSON"); process.exit(1); }
        }
        const code = await runHookTest({
          projectRoot: opts.cwd as string,
          scope: opts.scope === "project" ? "project" : "local",
          event: opts.event as string,
          toolName: opts.tool as string | undefined,
          toolInput,
        });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command("remove")
      .description("Remove a hook by event + index")
      .requiredOption("--event <event>", "Event name")
      .option("--index <n>", "Hook index (default 0)", (v) => parseInt(v, 10), 0)
      .option("--scope <scope>", "local | project", "local")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: Record<string, unknown>) => {
        const code = await runHookRemove({
          projectRoot: opts.cwd as string,
          scope: opts.scope === "project" ? "project" : "local",
          event: opts.event as string,
          index: opts.index as number,
        });
        process.exit(code);
      }),
  );

// ── Permission management ───────────────────────────────

program
  .command("permission")
  .alias("perm")
  .description("Manage permission rules stored in settings(.local).json")
  .addCommand(
    new Command("list")
      .description("List permission rules in effect")
      .option("--scope <scope>", "local | project", "local")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: { scope?: string; cwd?: string }) => {
        const code = await runPermList({ projectRoot: opts.cwd, scope: opts.scope === "project" ? "project" : "local" });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command("allow")
      .description("Set a rule to allow")
      .requiredOption("--tool <tool>", "Tool name or glob")
      .option("--args <pattern>", "Substring pattern against JSON.stringify(params)")
      .option("--scope <scope>", "local | project", "local")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: Record<string, unknown>) => {
        const code = await runPermSet({
          projectRoot: opts.cwd as string,
          scope: opts.scope === "project" ? "project" : "local",
          tool: opts.tool as string,
          action: "allow",
          args: opts.args as string | undefined,
        });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command("deny")
      .description("Set a rule to deny")
      .requiredOption("--tool <tool>", "Tool name or glob")
      .option("--args <pattern>", "Substring pattern")
      .option("--scope <scope>", "local | project", "local")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: Record<string, unknown>) => {
        const code = await runPermSet({
          projectRoot: opts.cwd as string,
          scope: opts.scope === "project" ? "project" : "local",
          tool: opts.tool as string,
          action: "deny",
          args: opts.args as string | undefined,
        });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command("ask")
      .description("Set a rule to ask")
      .requiredOption("--tool <tool>", "Tool name or glob")
      .option("--args <pattern>", "Substring pattern")
      .option("--scope <scope>", "local | project", "local")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: Record<string, unknown>) => {
        const code = await runPermSet({
          projectRoot: opts.cwd as string,
          scope: opts.scope === "project" ? "project" : "local",
          tool: opts.tool as string,
          action: "ask",
          args: opts.args as string | undefined,
        });
        process.exit(code);
      }),
  )
  .addCommand(
    new Command("move")
      .description("Move a permission rule between project and local scopes")
      .requiredOption("--index <n>", "Rule index in the source scope", (v) => parseInt(v, 10))
      .requiredOption("--from <scope>", "local | project")
      .requiredOption("--to <scope>", "local | project")
      .option("--cwd <path>", "Project root", process.cwd())
      .action(async (opts: Record<string, unknown>) => {
        const code = await runPermMove({
          projectRoot: opts.cwd as string,
          index: opts.index as number,
          from: opts.from as "local" | "project",
          to: opts.to as "local" | "project",
        });
        process.exit(code);
      }),
  );

// ── Doctor command ──────────────────────────────────────

program
  .command("config")
  .description("Show merged settings (local > project > global)")
  .option("--format <fmt>", "Output format: text | json", "text")
  .option("--layer <layer>", "Inspect a single layer: global | project | local")
  .option("--cwd <path>", "Project root", process.cwd())
  .action(async (opts: Record<string, unknown>) => {
    const code = await runConfigShow({
      projectRoot: opts.cwd as string,
      format: (opts.format as "text" | "json") ?? "text",
      layer: opts.layer as "global" | "project" | "local" | undefined,
    });
    process.exit(code);
  });

program
  .command("memory")
  .description("Show user model / memory profile")
  .option("--user-id <id>", "User identifier", "default")
  .option("--format <fmt>", "Output format: text | json", "text")
  .option("--cwd <path>", "Project root", process.cwd())
  .action(async (opts: Record<string, unknown>) => {
    const code = await runMemoryShow({
      projectRoot: opts.cwd as string,
      userId: opts.userId as string,
      format: (opts.format as "text" | "json") ?? "text",
    });
    process.exit(code);
  });

program
  .command("doctor")
  .description("Check system configuration and dependencies")
  .option("--json", "Output in JSON format")
  .action(async (opts: { json?: boolean }) => {
    await doctorCommand(opts);
  });

program
  .command("update")
  .description("Check for and install updates")
  .option("--check", "Only check for updates, don't install")
  .option("--force", "Force update even if versions match")
  .action(async (opts: { check?: boolean; force?: boolean }) => {
    await updateCommand({ checkOnly: opts.check, force: opts.force });
  });

program
  .command("version")
  .description("Show version information")
  .action(async () => {
    await versionCommand();
  });

// ── Pipe support handler ────────────────────────────────

async function handlePipeMode(promptText: string | true | undefined, opts: any): Promise<void> {
  let prompt: string;

  if (typeof promptText === "string") {
    prompt = promptText;
  } else {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    prompt = Buffer.concat(chunks).toString("utf-8").trim();
  }

  if (!prompt) {
    console.error("Error: No prompt provided. Use -p 'text' or pipe text via stdin.");
    process.exit(1);
  }

  const outputFormat = opts.outputFormat || "text";
  const agentName = opts.agent || "coder";

  const transport = new StdioTransport({
    command: resolveCoreBinary(),
    args: [],
  });

  await transport.start();

  const { RookieClient, ToolRegistry, MemoryStore, ModelRouter } = await import("@rookie/agent-sdk");
  const client = new RookieClient(transport);
  const tools = new ToolRegistry();
  const memory = new MemoryStore();
  const _pipeRouter = new ModelRouter(); void _pipeRouter;

  const { fileReadTool, fileWriteTool, fileEditTool, shellExecuteTool, searchCodeTool, gitStatusTool, gitDiffTool } =
    await import("@rookie/agent-sdk");
  tools.register(fileReadTool);
  tools.register(fileWriteTool);
  tools.register(fileEditTool);
  tools.register(shellExecuteTool);
  tools.register(searchCodeTool);
  tools.register(gitStatusTool);
  tools.register(gitDiffTool);

  const agent = createAgent(agentName);
  if (!agent) {
    console.error(`Unknown agent: ${agentName}`);
    process.exit(1);
  }

  // Use a mock model for now (real model integration in the TUI)
  const mockModel = {
    name: "mock",
    capabilities: { streaming: false, functionCalling: false, vision: false, maxTokens: 4096, contextWindow: 8000 },
    chat: async () => ({ content: `[Agent ${agentName}] Processed: ${prompt.slice(0, 100)}` }),
    chatStream: async function* () { yield { type: "done" as const }; },
    chatWithToolsStream: async function* () { yield { type: "done" as const }; },
  };

  const context = {
    client,
    model: mockModel as any,
    memory,
    tools,
  };

  const results: string[] = [];

  for await (const event of agent.run({ message: prompt, history: [] }, context)) {
    if (event.type === "response") {
      if (outputFormat === "json" || outputFormat === "stream-json") {
        console.log(JSON.stringify(event));
      } else {
        results.push(event.content);
      }
    } else if (event.type === "error") {
      if (outputFormat === "json" || outputFormat === "stream-json") {
        console.log(JSON.stringify(event));
      } else {
        console.error(`Error: ${event.error}`);
      }
    }
  }

  if (outputFormat === "text" && results.length > 0) {
    console.log(results.join("\n"));
  }

  await transport.stop();
}

// ── Agent factory ───────────────────────────────────────

function createAgent(name: string) {
  // Lazy import to avoid circular deps
  switch (name) {
    case "coder":
      return new CoderAgent();
    case "explorer":
      return new ExplorerAgent();
    default:
      return null;
  }
}

async function createAgentAsync(name: string) {
  switch (name) {
    case "coder":
      return new CoderAgent();
    case "explorer":
      return new ExplorerAgent();
    case "reviewer": {
      const { ReviewerAgent } = await import("@rookie/agent-sdk");
      return new ReviewerAgent();
    }
    case "architect": {
      const { ArchitectAgent } = await import("@rookie/agent-sdk");
      return new ArchitectAgent();
    }
    default:
      return null;
  }
}

// ── Agent helpers ───────────────────────────────────────

async function runAgentTask(name: string, task: string): Promise<void> {
  const transport = new StdioTransport({
    command: resolveCoreBinary(),
    args: [],
  });

  await transport.start();

  const { RookieClient, ToolRegistry, MemoryStore, ModelRouter } = await import("@rookie/agent-sdk");
  const client = new RookieClient(transport);
  const tools = new ToolRegistry();
  const memory = new MemoryStore();
  const router = new ModelRouter();

  router.register("mock", {
    name: "mock",
    capabilities: { streaming: false, functionCalling: false, vision: false, maxTokens: 4096, contextWindow: 8000 },
    chat: async () => ({ content: "mock" }),
    chatStream: async function* () { yield { type: "done" as const }; },
    chatWithToolsStream: async function* () { yield { type: "done" as const }; },
  } as any);

  const { fileReadTool, fileWriteTool, shellExecuteTool, searchCodeTool } = await import("@rookie/agent-sdk");
  tools.register(fileReadTool);
  tools.register(fileWriteTool);
  tools.register(shellExecuteTool);
  tools.register(searchCodeTool);

  const context = { client, model: router.getDefault(), memory, tools };

  const agent = await createAgentAsync(name);
  if (!agent) {
    console.error(`Unknown agent: ${name}`);
    await transport.stop();
    return;
  }

  const orchestrator = new AgentOrchestrator();
  orchestrator.register({ name, agent, priority: 1, triggers: [] });

  try {
    for await (const event of orchestrator.runSingle(name, { message: task, history: [] }, context)) {
      const e = event as any;
      if (e.type === "thinking") console.log(`[${name}] ${e.content}`);
      else if (e.type === "response") console.log(e.content);
      else if (e.type === "error") console.error(`[${name}] Error: ${e.error}`);
    }
  } catch (e) {
    console.error("Agent failed:", e);
  }

  await transport.stop();
}

async function runAgentPipeline(agentNames: string[], task: string): Promise<void> {
  const transport = new StdioTransport({
    command: resolveCoreBinary(),
    args: [],
  });

  await transport.start();

  const { RookieClient, ToolRegistry, MemoryStore, ModelRouter } = await import("@rookie/agent-sdk");
  const client = new RookieClient(transport);
  const tools = new ToolRegistry();
  const memory = new MemoryStore();
  const router = new ModelRouter();

  router.register("mock", {
    name: "mock",
    capabilities: { streaming: false, functionCalling: false, vision: false, maxTokens: 4096, contextWindow: 8000 },
    chat: async () => ({ content: "mock" }),
    chatStream: async function* () { yield { type: "done" as const }; },
    chatWithToolsStream: async function* () { yield { type: "done" as const }; },
  } as any);

  const { fileReadTool, fileWriteTool, fileEditTool, shellExecuteTool, searchCodeTool, gitStatusTool, gitDiffTool } =
    await import("@rookie/agent-sdk");
  tools.register(fileReadTool);
  tools.register(fileWriteTool);
  tools.register(fileEditTool);
  tools.register(shellExecuteTool);
  tools.register(searchCodeTool);
  tools.register(gitStatusTool);
  tools.register(gitDiffTool);

  const context = { client, model: router.getDefault(), memory, tools };
  const orchestrator = new AgentOrchestrator({ mode: "sequential" });

  for (const name of agentNames) {
    const agent = await createAgentAsync(name);
    if (agent) {
      orchestrator.register({ name, agent, priority: 1, triggers: [] });
    } else {
      console.error(`Unknown agent: ${name}, skipping`);
    }
  }

  try {
    for await (const event of orchestrator.runSequential(agentNames, { message: task, history: [] }, context)) {
      const e = event as any;
      if (e.type === "agent_start") console.log(`\n>>> Agent: ${e.agent}`);
      else if (e.type === "agent_complete") console.log(`<<< Agent ${e.agent} complete`);
      else if (e.type === "handoff") console.log(`--- Handoff to ${e.data?.to} ---`);
      else if (e.type === "thinking") console.log(`  [think] ${e.content}`);
      else if (e.type === "response") console.log(`  ${e.content}`);
    }
  } catch (e) {
    console.error("Pipeline failed:", e);
  }

  await transport.stop();
}

async function runAgentParallel(agentNames: string[], task: string): Promise<void> {
  const transport = new StdioTransport({
    command: resolveCoreBinary(),
    args: [],
  });

  await transport.start();

  const { RookieClient, ToolRegistry, MemoryStore, ModelRouter } = await import("@rookie/agent-sdk");
  const client = new RookieClient(transport);
  const tools = new ToolRegistry();
  const memory = new MemoryStore();
  const router = new ModelRouter();

  router.register("mock", {
    name: "mock",
    capabilities: { streaming: false, functionCalling: false, vision: false, maxTokens: 4096, contextWindow: 8000 },
    chat: async () => ({ content: "mock" }),
    chatStream: async function* () { yield { type: "done" as const }; },
    chatWithToolsStream: async function* () { yield { type: "done" as const }; },
  } as any);

  const { fileReadTool, fileWriteTool, shellExecuteTool, searchCodeTool } = await import("@rookie/agent-sdk");
  tools.register(fileReadTool);
  tools.register(fileWriteTool);
  tools.register(shellExecuteTool);
  tools.register(searchCodeTool);

  const context = { client, model: router.getDefault(), memory, tools };
  const orchestrator = new AgentOrchestrator({ mode: "parallel" });

  for (const name of agentNames) {
    const agent = await createAgentAsync(name);
    if (agent) {
      orchestrator.register({ name, agent, priority: 1, triggers: [] });
    }
  }

  try {
    for await (const event of orchestrator.runParallel(agentNames, { message: task, history: [] }, context)) {
      const e = event as any;
      if (e.type === "agent_start") console.log(`⚡ ${e.agent} started`);
      else if (e.type === "agent_complete") console.log(`✓ ${e.agent} complete`);
      else if (e.type === "synthesis") console.log(`\n=== Synthesis ===\n${e.data?.summary}`);
      else if (e.type === "response") console.log(e.content);
    }
  } catch (e) {
    console.error("Parallel run failed:", e);
  }

  await transport.stop();
}

// ── Main entry point ────────────────────────────────────

// Handle -p flag before commander parses subcommands
const args = process.argv.slice(2);
const pIndex = args.findIndex((a) => a === "-p" || a === "--prompt");

if (pIndex !== -1) {
  const nextArg = args[pIndex + 1];
  const promptText = nextArg && !nextArg.startsWith("-") ? nextArg : undefined;

  // Parse remaining opts
  const opts = {
    outputFormat: "text",
    agent: "coder",
    model: undefined as string | undefined,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-o" || args[i] === "--output-format") opts.outputFormat = args[i + 1] || "text";
    if (args[i] === "--agent") opts.agent = args[i + 1] || "coder";
    if (args[i] === "--model") opts.model = args[i + 1];
  }

  handlePipeMode(promptText || true, opts).catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  });
} else {
  // Default action - start chat
  if (process.argv.length === 2) {
    process.argv.push("chat");
  }
  program.parse();
}
