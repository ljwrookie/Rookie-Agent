import { HookRegistry, type HookConfig, type HookEvent } from "@rookie/agent-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const HOOK_EVENTS: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "Stop",
  "PreCheckpoint",
  "PostCheckpoint",
  "PreCompact",
  "PostCompact",
  "OnPermissionAsk",
  "OnSkillProposed",
];

interface SettingsShape {
  hooks?: Record<string, HookConfig[]>;
  permissions?: unknown[];
  [k: string]: unknown;
}

/**
 * Resolve the effective settings.json path. We prefer the **local** file
 * (`.rookie/settings.local.json`) because hook writes should not land in the
 * repo-committed settings by default.
 */
export function settingsPath(projectRoot: string, scope: "local" | "project" = "local"): string {
  return path.join(
    projectRoot,
    ".rookie",
    scope === "local" ? "settings.local.json" : "settings.json",
  );
}

async function readSettings(file: string): Promise<SettingsShape> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    return JSON.parse(raw) as SettingsShape;
  } catch {
    return {};
  }
}

async function writeSettings(file: string, data: SettingsShape): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export interface HookListOptions {
  projectRoot?: string;
  scope?: "local" | "project";
}

export async function runHookList(opts: HookListOptions): Promise<number> {
  const root = opts.projectRoot ?? process.cwd();
  const file = settingsPath(root, opts.scope);
  const settings = await readSettings(file);
  const hooks = settings.hooks ?? {};
  const events = Object.keys(hooks);
  if (events.length === 0) {
    console.log("No hooks configured.");
    return 0;
  }
  for (const ev of events) {
    console.log(`• ${ev}`);
    for (const h of hooks[ev] ?? []) {
      const kind = h.command ? "shell" : h.url ? "http" : h.prompt ? "llm" : "?";
      const desc = h.command ?? h.url ?? h.prompt ?? "";
      const matcher = h.matcher ? ` [match=${h.matcher}]` : "";
      const canReject = h.canReject ? " [canReject]" : "";
      console.log(`    - ${kind}${matcher}${canReject}  ${desc}`);
    }
  }
  return 0;
}

export interface HookAddOptions {
  projectRoot?: string;
  scope?: "local" | "project";
  event: string;
  command?: string;
  url?: string;
  prompt?: string;
  matcher?: string;
  canReject?: boolean;
  blocking?: boolean;
  timeout?: number;
}

export async function runHookAdd(opts: HookAddOptions): Promise<number> {
  if (!HOOK_EVENTS.includes(opts.event as HookEvent)) {
    console.error(`Error: unknown event "${opts.event}". Allowed: ${HOOK_EVENTS.join(", ")}`);
    return 1;
  }
  if (!opts.command && !opts.url && !opts.prompt) {
    console.error("Error: one of --command / --url / --prompt must be provided.");
    return 1;
  }

  const root = opts.projectRoot ?? process.cwd();
  const file = settingsPath(root, opts.scope);
  const settings = await readSettings(file);
  settings.hooks = settings.hooks ?? {};
  settings.hooks[opts.event] = settings.hooks[opts.event] ?? [];

  const hook: HookConfig = {
    event: opts.event as HookEvent,
    command: opts.command,
    url: opts.url,
    prompt: opts.prompt,
    matcher: opts.matcher,
    canReject: opts.canReject,
    blocking: opts.blocking,
    timeout: opts.timeout,
  };
  settings.hooks[opts.event].push(hook);
  await writeSettings(file, settings);

  console.log(`✓ Registered ${opts.event} hook in ${path.relative(root, file)}`);
  return 0;
}

export interface HookTestOptions {
  projectRoot?: string;
  scope?: "local" | "project";
  event: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
}

export async function runHookTest(opts: HookTestOptions): Promise<number> {
  const root = opts.projectRoot ?? process.cwd();
  const file = settingsPath(root, opts.scope);
  const settings = await readSettings(file);

  const registry = new HookRegistry();
  registry.loadFromSettings(settings);

  const results = await registry.fire(opts.event as HookEvent, {
    sessionId: "test-session",
    toolName: opts.toolName,
    toolInput: opts.toolInput,
    projectRoot: root,
  });

  if (results.length === 0) {
    console.log(`No hooks matched for ${opts.event}${opts.toolName ? ` / ${opts.toolName}` : ""}.`);
    return 0;
  }

  let anyFail = false;
  for (const r of results) {
    const mark = r.success ? "✓" : r.rejected ? "✗" : "!";
    console.log(`${mark} ${opts.event}  (${r.duration}ms)  ${r.hook.command ?? r.hook.url ?? r.hook.prompt ?? ""}`);
    if (r.output) console.log(r.output.split("\n").map((l) => "    " + l).join("\n"));
    if (!r.success) anyFail = true;
  }
  return anyFail ? 1 : 0;
}

export interface HookRemoveOptions {
  projectRoot?: string;
  scope?: "local" | "project";
  event: string;
  index?: number;
}

export async function runHookRemove(opts: HookRemoveOptions): Promise<number> {
  const root = opts.projectRoot ?? process.cwd();
  const file = settingsPath(root, opts.scope);
  const settings = await readSettings(file);
  const list = settings.hooks?.[opts.event];
  if (!list || list.length === 0) {
    console.error(`Error: no hooks registered for ${opts.event}`);
    return 1;
  }
  const idx = opts.index ?? 0;
  if (idx < 0 || idx >= list.length) {
    console.error(`Error: index ${idx} out of range (0..${list.length - 1})`);
    return 1;
  }
  const removed = list.splice(idx, 1)[0];
  if (list.length === 0 && settings.hooks) delete settings.hooks[opts.event];
  await writeSettings(file, settings);
  console.log(`✓ Removed ${opts.event} hook #${idx}: ${removed.command ?? removed.url ?? removed.prompt ?? ""}`);
  return 0;
}
