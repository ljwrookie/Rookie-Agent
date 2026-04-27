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
    paramsHint: "run `rookie verify` outside the TUI for streaming output",
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
        "List the current tasks from `.rookie/progress.md` and suggest the next action.",
    }),
  }),

  // ── System / admin ──────────────────────────────────────────────
  mk({
    name: "config",
    description: "Show merged settings (local > project > global)",
    usage: "/config [--layer global|project|local]",
    paramsHint: "non-interactive form: `rookie config`",
    category: "system",
    handler: async () => ({
      systemMessage:
        "Run `rookie config` in another shell to see the merged settings (supports --format json / --layer).",
    }),
  }),
  mk({
    name: "hook",
    description: "Manage hooks (list/add/test/remove)",
    usage: "/hook",
    paramsHint: "run `rookie hook --help` outside the TUI",
    category: "system",
    handler: async () => ({
      systemMessage:
        "Use `rookie hook list|add|test|remove` from the CLI. The TUI will surface hook events in the log view.",
    }),
  }),
  mk({
    name: "doctor",
    description: "Check system configuration and dependencies",
    usage: "/doctor",
    category: "system",
    handler: async () => ({
      systemMessage: "Run `rookie doctor` outside the TUI to inspect binaries, API keys, and transports.",
    }),
  }),
  mk({
    name: "skill",
    description: "List available skills (SKILL.md)",
    usage: "/skill",
    category: "system",
    handler: async () => ({
      systemMessage:
        "Skill management: place SKILL.md files under `.rookie/skills/` (project) or `~/.rookie/skills/` (global).",
    }),
  }),
  // B4: Undo command for file history
  mk({
    name: "undo",
    description: "Restore a file from snapshot history",
    usage: "/undo [<snapshot-id>] [file-path]",
    paramsHint: "Without args: list recent snapshots. With snapshot-id: restore that snapshot.",
    category: "workflow",
    handler: async (ctx) => {
      const { getSnapshotManager } = await import("../tools/snapshot.js");
      const snapshotManager = getSnapshotManager();

      // No args: list snapshots
      if (ctx.args.length === 0) {
        const snapshots = await snapshotManager.listAllSnapshots();
        if (snapshots.length === 0) {
          return { systemMessage: "No snapshots found. Snapshots are created automatically when editing files." };
        }
        const lines = snapshots.slice(0, 20).map((s, i) => {
          const time = new Date(s.timestamp).toLocaleString();
          const reason = s.reason || "edit";
          return `${i + 1}. ${s.id} — ${s.path} (${reason}) at ${time}`;
        });
        return { systemMessage: `Recent snapshots:\n${lines.join("\n")}` };
      }

      // With args: restore snapshot
      const snapshotId = ctx.args[0];
      const success = await snapshotManager.restoreSnapshot(snapshotId);

      if (success) {
        return { systemMessage: `Restored snapshot ${snapshotId}` };
      } else {
        return { systemMessage: `[ERROR] Snapshot not found: ${snapshotId}` };
      }
    },
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
