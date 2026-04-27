import type { PermissionAction, PermissionRule } from "@rookie/agent-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { settingsPath } from "./hook.js";

interface SettingsShape {
  permissions?: PermissionRule[];
  [k: string]: unknown;
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

export interface PermListOptions {
  projectRoot?: string;
  scope?: "local" | "project";
}

export async function runPermList(opts: PermListOptions): Promise<number> {
  const root = opts.projectRoot ?? process.cwd();
  const file = settingsPath(root, opts.scope);
  const settings = await readSettings(file);
  const rules = settings.permissions ?? [];
  if (rules.length === 0) {
    console.log("No custom permission rules (SDK defaults are in effect).");
    return 0;
  }
  rules.forEach((r, i) => {
    const args = r.args ? `  args~=${JSON.stringify(r.args)}` : "";
    console.log(`[${i}]  ${r.action.padEnd(5)}  ${r.tool}${args}`);
  });
  return 0;
}

export interface PermSetOptions {
  projectRoot?: string;
  scope?: "local" | "project";
  tool: string;
  action: PermissionAction;
  args?: string;
}

/**
 * Upsert a rule: if an existing rule has the same `tool` + `args` we overwrite
 * its action, otherwise we prepend (rules are first-match-wins).
 */
export async function runPermSet(opts: PermSetOptions): Promise<number> {
  const root = opts.projectRoot ?? process.cwd();
  const file = settingsPath(root, opts.scope);
  const settings = await readSettings(file);
  const rules = settings.permissions ?? [];

  const existingIdx = rules.findIndex(
    (r) => r.tool === opts.tool && (r.args ?? "") === (opts.args ?? ""),
  );
  if (existingIdx >= 0) {
    rules[existingIdx].action = opts.action;
  } else {
    rules.unshift({ tool: opts.tool, action: opts.action, args: opts.args });
  }

  settings.permissions = rules;
  await writeSettings(file, settings);
  console.log(`✓ ${opts.action} ${opts.tool}${opts.args ? ` (args~=${opts.args})` : ""} → ${path.relative(root, file)}`);
  return 0;
}

export interface PermMoveOptions {
  projectRoot?: string;
  from: "local" | "project";
  to: "local" | "project";
  index: number;
}

/**
 * Move a rule between `settings.json` and `settings.local.json`. Useful for
 * promoting an ad-hoc approval to a team-shared policy, or vice versa.
 */
export async function runPermMove(opts: PermMoveOptions): Promise<number> {
  if (opts.from === opts.to) {
    console.error("Error: --from and --to must differ.");
    return 1;
  }
  const root = opts.projectRoot ?? process.cwd();
  const fromFile = settingsPath(root, opts.from);
  const toFile = settingsPath(root, opts.to);

  const fromSettings = await readSettings(fromFile);
  const fromRules = fromSettings.permissions ?? [];
  if (opts.index < 0 || opts.index >= fromRules.length) {
    console.error(`Error: index ${opts.index} out of range for ${opts.from} (0..${fromRules.length - 1})`);
    return 1;
  }
  const [rule] = fromRules.splice(opts.index, 1);
  fromSettings.permissions = fromRules;
  await writeSettings(fromFile, fromSettings);

  const toSettings = await readSettings(toFile);
  toSettings.permissions = toSettings.permissions ?? [];
  toSettings.permissions.unshift(rule);
  await writeSettings(toFile, toSettings);

  console.log(`✓ Moved rule ${JSON.stringify(rule)} from ${opts.from} → ${opts.to}`);
  return 0;
}
