/**
 * Default slash commands (P1-T2)
 *
 * The set below matches the roadmap deliverables plus the TUI's legacy
 * commands, so adopting the registry is a strict upgrade — nothing disappears.
 *
 * Each handler returns a *pure intent* (prompt / systemMessage / mode / …).
 * The TUI materialises the intent; non-interactive entry points (CLI `-p`,
 * tests, scripts) can inspect the result directly.
 *
 * Commands whose real behaviour lives in the CLI (e.g. /verify, /hook, /config)
 * still get a command entry here so suggestions + docs show up in the TUI.
 * The handler emits a friendly systemMessage explaining the CLI form.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { CommandRegistry } from "./registry.js";
import type { SlashCommand } from "./types.js";
import { intervalToString, type ScheduleInterval } from "../scheduler/parser.js";

function formatInterval(interval: ScheduleInterval): string {
  return intervalToString(interval);
}

function mk(cmd: SlashCommand): SlashCommand {
  return { source: "builtin", ...cmd };
}

export const DEFAULT_COMMANDS: SlashCommand[] = [
  // ── Navigation / UI ─────────────────────────────────────────────
  mk({
    name: "help",
    description: "Show all commands",
    usage: "/help",
    category: "system",
    handler: async () => ({ showHelp: true }),
  }),
  mk({
    name: "clear",
    description: "Clear the event stream",
    usage: "/clear",
    category: "system",
    handler: async () => ({ clear: true }),
  }),
  mk({
    name: "status",
    description: "Show status overview",
    usage: "/status",
    category: "system",
    handler: async (ctx) => {
      const model = (ctx.meta?.modelName as string) ?? "unknown";
      const mode = (ctx.meta?.mode as string) ?? "chat";
      return { systemMessage: `Status: model=${model} · mode=${mode}` };
    },
  }),
  mk({
    name: "plan",
    description: "Switch to plan view",
    usage: "/plan",
    category: "navigation",
    handler: async () => ({ mode: "plan" }),
  }),
  mk({
    name: "diff",
    description: "Switch to diff view",
    usage: "/diff [--staged]",
    paramsHint: "--staged: show staged-only diff",
    category: "navigation",
    handler: async () => ({ mode: "diff" }),
  }),
  mk({
    name: "logs",
    description: "Switch to logs view",
    usage: "/logs",
    category: "navigation",
    handler: async () => ({ mode: "logs" }),
  }),
  mk({
    name: "context",
    description: "Show context summary",
    usage: "/context",
    category: "system",
    handler: async () => ({ prompt: "Show me the current context briefly." }),
  }),
  mk({
    name: "approve",
    description: "Open the approval queue",
    usage: "/approve",
    category: "navigation",
    handler: async () => ({ mode: "approve" }),
  }),
  mk({
    name: "review",
    description: "Review pending changes",
    usage: "/review",
    category: "workflow",
    handler: async () => ({
      prompt:
        "Review the current working-tree changes. Point out issues, risky edits, and suggest follow-ups.",
    }),
  }),

  // ── Workflow ────────────────────────────────────────────────────
  mk({
    name: "commit",
    description: "Prepare a commit message",
    usage: "/commit",
    category: "workflow",
    handler: async () => ({ prompt: "Prepare a commit message for the current changes." }),
  }),
  mk({
    name: "tests",
    description: "Run the project tests",
    usage: "/tests",
    category: "workflow",
    handler: async () => ({ prompt: "Run the project tests and summarize results." }),
  }),
  mk({
    name: "verify",
    description: "Run features.json verifyCommands",
    usage: "/verify [--feature <id>] [--bail]",
    paramsHint: "verify current features against features.json",
    category: "workflow",
    handler: async (ctx) => {
      const extra = ctx.args.join(" ").trim();
      const suffix = extra ? ` with \`${extra}\`` : "";
      return {
        prompt: `Run \`rookie verify\`${suffix} and report any failing feature with logs.`,
      };
    },
  }),
  mk({
    name: "compact",
    description: "Force-compact the conversation context",
    usage: "/compact",
    category: "workflow",
    handler: async (ctx) => {
      // The compactor lives in the TUI / harness layer. If the caller has
      // supplied a forcer on ctx.meta.compact we delegate; otherwise we just
      // tell the user how to enable auto-compaction.
      const force = ctx.meta?.compact;
      if (typeof force === "function") {
        try {
          const result = await (force as () => Promise<{ before: unknown; after: unknown }>)();
          const res = result as {
            before: { tokens: number; messages: number };
            after: { tokens: number; messages: number };
          };
          return {
            systemMessage:
              `Compacted: messages ${res.before.messages} → ${res.after.messages}, ` +
              `tokens ${res.before.tokens} → ${res.after.tokens}.`,
          };
        } catch (e) {
          const err = e instanceof Error ? e.message : String(e);
          return { systemMessage: `Compaction failed: ${err}` };
        }
      }
      return {
        systemMessage:
          "No compactor wired. Auto-compaction triggers at 80% of the model's context window.",
      };
    },
  }),
  mk({
    name: "schedule",
    description: "Schedule a recurring command: /schedule <interval> <command>",
    usage: "/schedule <5m|1h|@daily|cron(* * * * *)> <command>",
    category: "workflow",
    handler: async (ctx) => {
      const { getGlobalScheduler } = await import("../scheduler/index.js");
      const scheduler = getGlobalScheduler();
      if (!scheduler) {
        return { systemMessage: "[ERROR] Scheduler not initialized. Start with `rookie scheduler start`." };
      }

      // No args: list tasks
      if (ctx.args.length === 0) {
        const tasks = scheduler.getTasks();
        if (tasks.length === 0) {
          return { systemMessage: "No scheduled tasks. Use `/schedule <interval> <command>` to add one." };
        }
        const lines = tasks.map((t) => {
          const status = t.enabled ? "✓" : "✗";
          const interval = t.interval ? formatInterval(t.interval) : "unknown";
          const next = t.nextRun ? new Date(t.nextRun).toLocaleString() : "N/A";
          return `[${status}] ${t.id}: ${t.name} (${interval}) → next: ${next}`;
        });
        return { systemMessage: `Scheduled tasks:\n${lines.join("\n")}` };
      }

      // Parse: /schedule <interval> <command...>
      const intervalExpr = ctx.args[0];
      const command = ctx.args.slice(1).join(" ").trim();
      if (!command) {
        return { systemMessage: "[ERROR] Usage: /schedule <interval> <command>" };
      }

      const result = await scheduler.schedule(command.slice(0, 50), command, intervalExpr, false);
      if (!result.success) {
        return { systemMessage: `[ERROR] ${result.error}` };
      }
      return { systemMessage: `Scheduled: ${result.task!.id} — ${command} (${intervalExpr})` };
    },
  }),
  mk({
    name: "loop",
    description: "Run a command in a loop: /loop <interval> <command>",
    usage: "/loop <5m|1h|@daily|cron(* * * * *)> <command>",
    category: "workflow",
    handler: async (ctx) => {
      const { getGlobalScheduler } = await import("../scheduler/index.js");
      const scheduler = getGlobalScheduler();
      if (!scheduler) {
        return { systemMessage: "[ERROR] Scheduler not initialized." };
      }

      if (ctx.args.length < 2) {
        return { systemMessage: "[ERROR] Usage: /loop <interval> <command>" };
      }

      const intervalExpr = ctx.args[0];
      const command = ctx.args.slice(1).join(" ").trim();

      const result = await scheduler.schedule(command.slice(0, 50), command, intervalExpr, true);
      if (!result.success) {
        return { systemMessage: `[ERROR] ${result.error}` };
      }
      return { systemMessage: `Loop scheduled: ${result.task!.id} — ${command} (${intervalExpr})` };
    },
  }),
  mk({
    name: "unschedule",
    description: "Cancel a scheduled task: /unschedule <id>",
    usage: "/unschedule <task-id>",
    category: "workflow",
    handler: async (ctx) => {
      const { getGlobalScheduler } = await import("../scheduler/index.js");
      const scheduler = getGlobalScheduler();
      if (!scheduler) {
        return { systemMessage: "[ERROR] Scheduler not initialized." };
      }

      const taskId = ctx.args[0];
      if (!taskId) {
        return { systemMessage: "[ERROR] Usage: /unschedule <task-id>" };
      }

      const success = await scheduler.unschedule(taskId);
      if (!success) {
        return { systemMessage: `[ERROR] Task not found: ${taskId}` };
      }
      return { systemMessage: `Cancelled: ${taskId}` };
    },
  }),
  mk({
    name: "todo",
    description: "Show / update the task list",
    usage: "/todo",
    category: "workflow",
    handler: async () => ({
      prompt:
        "List the current tasks from `.rookie/todos.json` and suggest the next action.",
    }),
  }),

  // ── System / admin ──────────────────────────────────────────────
  mk({
    name: "config",
    description: "Show merged settings (local > project > global)",
    usage: "/config [--layer global|project|local]",
    paramsHint: "non-interactive form: `rookie config`",
    category: "system",
    handler: async (ctx) => {
      const { ConfigManager, loadSettings } = await import("../index.js");
      const layer = ctx.args.find((a) => ["global", "project", "local"].includes(a));
      const projectRoot = (ctx.meta?.projectRoot as string) ?? process.cwd();

      try {
        if (layer === "global") {
          const cm = new ConfigManager();
          const cfg = await cm.load();
          return { systemMessage: `Global config:\n${JSON.stringify(cfg, null, 2)}` };
        }
        if (layer === "local") {
          const localPath = path.join(projectRoot, ".rookie", "settings.local.json");
          try {
            const raw = await fs.readFile(localPath, "utf-8");
            const parsed = JSON.parse(raw);
            return { systemMessage: `Local config:\n${JSON.stringify(parsed, null, 2)}` };
          } catch {
            return { systemMessage: "No local settings found at .rookie/settings.local.json" };
          }
        }
        // Default: merged view
        const { merged } = await loadSettings({ projectRoot });
        return { systemMessage: `Merged settings (local > project > global):\n${JSON.stringify(merged, null, 2)}` };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return { systemMessage: `[ERROR] Failed to load config: ${err}` };
      }
    },
  }),
  mk({
    name: "hook",
    description: "Manage hooks (list/add/test/remove)",
    usage: "/hook [list|test <event>|remove <id>]",
    paramsHint: "list: show all hooks. test <event>: fire a test event. remove <id>: remove hook by id.",
    category: "system",
    handler: async (ctx) => {
      const sub = ctx.args[0] ?? "list";
      const { HookRegistry } = await import("../index.js");
      // Hooks are stored in settings; load from project root
      const projectRoot = (ctx.meta?.projectRoot as string) ?? process.cwd();
      const { loadSettings } = await import("../index.js");

      try {
        const { merged } = await loadSettings({ projectRoot });
        const hooks = (merged.hooks ?? {}) as Record<string, unknown[]>;

        if (sub === "list") {
          const entries = Object.entries(hooks);
          if (entries.length === 0) {
            return { systemMessage: "No hooks registered. Add hooks via .rookie/settings.local.json" };
          }
          const lines = entries.map(([event, configs]) => {
            const count = Array.isArray(configs) ? configs.length : 0;
            return `${event}: ${count} hook(s)`;
          });
          return { systemMessage: `Registered hooks:\n${lines.join("\n")}` };
        }

        if (sub === "test" && ctx.args[1]) {
          const event = ctx.args[1];
          const registry = new HookRegistry();
          registry.loadFromSettings(merged);
          const results = await registry.fire(event as any, { projectRoot, sessionId: "test" });
          const successCount = results.filter((r) => r.success).length;
          return { systemMessage: `Fired ${event}: ${results.length} result(s), ${successCount} succeeded` };
        }

        return { systemMessage: "Usage: /hook [list|test <event>|remove <id>]" };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return { systemMessage: `[ERROR] Hook command failed: ${err}` };
      }
    },
  }),
  mk({
    name: "doctor",
    description: "Check system configuration and dependencies",
    usage: "/doctor",
    category: "system",
    handler: async () => {
      const checks: string[] = [];
      // API keys
      const keys = ["OPENAI_API_KEY", "ARK_API_KEY", "ANTHROPIC_API_KEY"];
      for (const k of keys) {
        checks.push(`${process.env[k] ? "✓" : "✗"} ${k}`);
      }
      // Node version
      checks.push(`Node: ${process.version}`);
      // Platform
      checks.push(`Platform: ${process.platform} (${process.arch})`);
      // Core binary
      try {
        const { resolveCoreBinary } = await import("../index.js");
        const bin = resolveCoreBinary();
        checks.push(`✓ Core binary: ${bin}`);
      } catch {
        checks.push("✗ Core binary not found");
      }
      // Git
      try {
        const { execSync } = await import("child_process");
        const git = execSync("git --version", { encoding: "utf-8", timeout: 3000 }).trim();
        checks.push(`✓ ${git}`);
      } catch {
        checks.push("✗ git not found");
      }
      return { systemMessage: `System check:\n${checks.join("\n")}` };
    },
  }),
  mk({
    name: "skill",
    description: "List available skills (SKILL.md)",
    usage: "/skill [list|search <query>]",
    category: "system",
    handler: async (ctx) => {
      const { SkillRegistry } = await import("../index.js");
      const projectRoot = (ctx.meta?.projectRoot as string) ?? process.cwd();
      const sub = ctx.args[0] ?? "list";

      try {
        const skills = new SkillRegistry({ storageDir: path.join(projectRoot, ".rookie", "skills") });
        await skills.loadAll(projectRoot);
        const all = skills.list();

        if (sub === "search" && ctx.args[1]) {
          const query = ctx.args.slice(1).join(" ");
          const matches = skills.findBySemanticMatch(query, 5);
          if (matches.length === 0) {
            return { systemMessage: `No skills match "${query}"` };
          }
          const lines = matches.map((m) => `${m.skill.name} (score: ${m.score.toFixed(2)}) — ${m.skill.description}`);
          return { systemMessage: `Skills matching "${query}":\n${lines.join("\n")}` };
        }

        if (all.length === 0) {
          return { systemMessage: "No skills found. Add SKILL.md files to .rookie/skills/ (project) or ~/.rookie/skills/ (global)." };
        }
        const lines = all.map((s) => `• ${s.name} — ${s.description}`);
        return { systemMessage: `Available skills (${all.length}):\n${lines.join("\n")}` };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        return { systemMessage: `[ERROR] Skill command failed: ${err}` };
      }
    },
  }),
  // P3.1: Model picker command
  mk({
    name: "model",
    description: "Open model picker overlay",
    usage: "/model",
    category: "system",
    handler: async () => ({ mode: "model" }),
  }),
  // B4: Undo command for file history
  mk({
    name: "undo",
    description: "Restore a file from snapshot history",
    usage: "/undo [<snapshot-id>]",
    paramsHint: "Without args: list recent snapshots. With snapshot-id: restore that snapshot.",
    category: "workflow",
    handler: async (ctx) => {
      const { listSnapshots, restoreSnapshot } = await import("../tools/snapshot.js");
      const projectRoot = ctx.meta?.projectRoot as string | undefined ?? process.cwd();

      // No args: list snapshots
      if (ctx.args.length === 0) {
        const snapshots = await listSnapshots(projectRoot);
        if (snapshots.length === 0) {
          return { systemMessage: "No snapshots found. Snapshots are created automatically when editing files." };
        }
        const lines = snapshots.slice(0, 20).map((s, i) => {
          const time = new Date(s.timestamp).toLocaleString();
          return `${i + 1}. ${s.id} — ${s.filePath} at ${time}`;
        });
        return { systemMessage: `Recent snapshots (newest first):\n${lines.join("\n")}` };
      }

      // With args: restore snapshot
      const snapshotId = ctx.args[0];
      const success = await restoreSnapshot(projectRoot, snapshotId);

      if (success) {
        return { systemMessage: `Restored snapshot ${snapshotId}` };
      } else {
        return { systemMessage: `[ERROR] Snapshot not found or restore failed: ${snapshotId}` };
      }
    },
  }),
  // P3.3: Checkpoint overlay command
  mk({
    name: "checkpoint",
    description: "Open checkpoint history overlay",
    usage: "/checkpoint",
    category: "navigation",
    handler: async () => ({ mode: "checkpoint" }),
  }),
  // A3: Theme switching command
  mk({
    name: "theme",
    description: "Switch TUI theme (dark/light/high-contrast)",
    usage: "/theme [dark|light|high-contrast]",
    paramsHint: "Without args: show current theme. With arg: switch to theme.",
    category: "system",
    handler: async (ctx) => {
      const validThemes = ["dark", "light", "high-contrast"];
      const themeArg = ctx.args[0];

      if (!themeArg) {
        // Get current theme from meta or default
        const currentTheme = (ctx.meta?.theme as string) ?? "dark";
        return { systemMessage: `Current theme: ${currentTheme}. Available: ${validThemes.join(", ")}` };
      }

      if (!validThemes.includes(themeArg)) {
        return { systemMessage: `[ERROR] Invalid theme: ${themeArg}. Available: ${validThemes.join(", ")}` };
      }

      // Return theme change intent - actual change happens in TUI layer
      return { theme: themeArg as "dark" | "light" | "high-contrast" };
    },
  }),
  // D3: Coordinator mode command
  mk({
    name: "coordinator",
    description: "Run coordinator mode to split tasks among worker agents",
    usage: "/coordinator <task description>",
    paramsHint: "Splits the task into subtasks and delegates to workers with restricted tools.",
    category: "workflow",
    handler: async (ctx) => {
      const task = ctx.args.join(" ").trim();
      if (!task) {
        return { systemMessage: "[ERROR] Usage: /coordinator <task description>" };
      }

      // Set orchestrator mode to coordinator
      return {
        systemMessage: `Starting coordinator mode for: ${task.slice(0, 100)}${task.length > 100 ? "..." : ""}`,
        prompt: task,
      };
    },
  }),
  // D4: Pipe IPC command
  mk({
    name: "pipes",
    description: "List all active Rookie instances on this machine",
    usage: "/pipes [--ping]",
    paramsHint: "With --ping: also check connectivity to each instance.",
    category: "system",
    handler: async (ctx) => {
      const { getGlobalPipeManager, initPipeManager } = await import("../pipes/index.js");
      const shouldPing = ctx.args.includes("--ping");

      let manager = getGlobalPipeManager();
      if (!manager) {
        try {
          manager = await initPipeManager();
        } catch (e) {
          return { systemMessage: `[ERROR] Failed to initialize pipe manager: ${e}` };
        }
      }

      const instances = await manager.listInstances();
      const currentId = manager.getInstanceId();

      if (instances.length === 0) {
        return { systemMessage: "No other Rookie instances found." };
      }

      const lines: string[] = [`Active Rookie instances (${instances.length}):`, ""];

      if (shouldPing) {
        const pingResults = await manager.pingAll();
        for (const instance of instances) {
          const isSelf = instance.id === currentId;
          const isUp = pingResults.get(instance.id);
          const status = isSelf ? "👤 you" : isUp ? "🟢 up" : "🔴 down";
          lines.push(`${status} · ${instance.id}`);
          if (instance.metadata) {
            lines.push(`   metadata: ${JSON.stringify(instance.metadata).slice(0, 100)}`);
          }
        }
      } else {
        for (const instance of instances) {
          const isSelf = instance.id === currentId;
          lines.push(`${isSelf ? "👤" : "📡"} · ${instance.id}${isSelf ? " (you)" : ""}`);
        }
      }

      return { systemMessage: lines.join("\n") };
    },
  }),
  // D5: History command for transcripts
  mk({
    name: "history",
    description: "List recent conversation transcripts",
    usage: "/history [limit] [--delete <session-id>]",
    paramsHint: "Shows last 20 transcripts. Use --delete to remove a transcript.",
    category: "system",
    handler: async (ctx) => {
      const { TranscriptManager } = await import("../harness/transcript.js");

      // Handle delete
      const deleteIndex = ctx.args.indexOf("--delete");
      if (deleteIndex >= 0 && ctx.args[deleteIndex + 1]) {
        const sessionId = ctx.args[deleteIndex + 1];
        const success = await TranscriptManager.deleteTranscript(sessionId);
        if (success) {
          return { systemMessage: `Deleted transcript: ${sessionId}` };
        } else {
          return { systemMessage: `[ERROR] Failed to delete transcript: ${sessionId}` };
        }
      }

      // Parse limit
      const limitArg = ctx.args.find((a) => /^\d+$/.test(a));
      const limit = limitArg ? parseInt(limitArg, 10) : 20;

      const transcripts = await TranscriptManager.listTranscripts(limit);

      if (transcripts.length === 0) {
        return { systemMessage: "No transcripts found. Transcripts are saved automatically during sessions." };
      }

      const lines: string[] = [`Recent transcripts (${transcripts.length}):`, ""];

      for (let i = 0; i < transcripts.length; i++) {
        const t = transcripts[i];
        const date = new Date(t.createdAt).toLocaleString();
        lines.push(`${i + 1}. ${t.sessionId}`);
        lines.push(`   Created: ${date} · Records: ${t.recordCount}`);
        lines.push(`   Resume: rookie code --resume ${t.sessionId}`);
        lines.push("");
      }

      return { systemMessage: lines.join("\n") };
    },
  }),
];

/**
 * Populate a fresh CommandRegistry with the default command set. Returns the
 * registry for chaining.
 */
export function registerDefaults(registry: CommandRegistry): CommandRegistry {
  for (const cmd of DEFAULT_COMMANDS) registry.register(cmd);
  return registry;
}

/**
 * Convenience: create a registry pre-populated with the defaults.
 */
export function createDefaultRegistry(): CommandRegistry {
  const reg = new CommandRegistry();
  registerDefaults(reg);
  return reg;
}
