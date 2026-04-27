// ─── Three-tier settings loader (P1-T1) ──────────────────────────
// Layer precedence: local (repo, gitignored) > project (repo, committed)
// > global (~/.rookie/settings.json). Local overrides project overrides
// global, which is the same shape Claude Code / VS Code use.
//
// The canonical file is `.rookie/settings.json` (project) and
// `.rookie/settings.local.json` (local). Global lives at
// `~/.rookie/settings.json`. The legacy `~/.rookie/config.json` continues
// to be handled by `ConfigManager` — this loader is purely additive.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { HookConfig } from "../hooks/types.js";
import type { PermissionRule } from "../permissions/types.js";

/** A3: Theme name for TUI */
export type ThemeName = "dark" | "light" | "high-contrast";

/**
 * Shape of a user-facing settings file. All fields are optional: we merge
 * three sparse objects and only the fields that exist flow through.
 */
export interface RookieSettings {
  /** Permission rules applied by `PermissionManager` (first-match-wins). */
  permissions?: PermissionRule[];
  /** Lifecycle hooks grouped by event. */
  hooks?: Record<string, HookConfig[]>;
  /** Environment variables surfaced to shell hooks and tool execution. */
  env?: Record<string, string>;
  /** Default model + provider overrides. */
  model?: {
    default?: string;
    providers?: Record<string, unknown>;
  };
  /** Skill enablement flags; { enabled: ["skillA", "!skillB"] } style. */
  skills?: {
    enabled?: string[];
    disabled?: string[];
  };
  /** Declarative scheduler entries consumed by P1-T7. */
  schedulers?: Array<Record<string, unknown>>;
  /** Logger level / sink config for P0-T2 logger. */
  logging?: {
    level?: string;
    path?: string;
    maxKeep?: number;
  };
  /** A3: TUI theme selection */
  theme?: ThemeName;
  /** A7: Status line shell command for bottom bar */
  statusLine?: string;
  /** B2: MCP server configurations for auto-registration */
  mcpServers?: Record<string, McpServerConfig>;
  /** Escape hatch: arbitrary user-defined keys are preserved verbatim. */
  [key: string]: unknown;
}

/** B2: MCP server configuration */
export interface McpServerConfig {
  transport: "stdio" | "sse" | "inprocess";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  /** Whether to auto-register tools from this server */
  autoRegister?: boolean;
}

/**
 * Where each settings file lives on disk. `global` defaults to
 * `~/.rookie/settings.json` but can be overridden for testing or sandbox
 * scenarios.
 */
export interface SettingsPaths {
  global: string;
  project: string;
  local: string;
}

export type SettingsLayer = "global" | "project" | "local";

export interface LoadSettingsOptions {
  /** Project root (where `.rookie/` lives). Defaults to `process.cwd()`. */
  projectRoot?: string;
  /** Override the home directory (useful for tests). */
  home?: string;
  /** Fully override every layer path; mutually exclusive with home/projectRoot. */
  paths?: Partial<SettingsPaths>;
}

export interface LoadedLayer {
  /** Absolute path of the file we tried to read. */
  path: string;
  /** The parsed content (empty object if the file is missing or invalid). */
  data: RookieSettings;
  /** True when the file existed and parsed OK. */
  exists: boolean;
}

export interface MergedSettings {
  /** Fully merged view — `local > project > global`. */
  merged: RookieSettings;
  /** Per-layer raw view, handy for `rookie config` to annotate sources. */
  layers: Record<SettingsLayer, LoadedLayer>;
  /**
   * `origins[field] = layer` records the highest-priority layer that
   * contributed `merged[field]`. Scalars point to the winning layer; arrays
   * and objects report the **top** contributor (later layers prepend arrays
   * or recursively deep-merge objects).
   */
  origins: Partial<Record<keyof RookieSettings, SettingsLayer>>;
}

/** Resolve the default layer paths from home + projectRoot. */
export function resolveSettingsPaths(
  opts: Pick<LoadSettingsOptions, "projectRoot" | "home" | "paths"> = {},
): SettingsPaths {
  const home = opts.home ?? os.homedir();
  const projectRoot = opts.projectRoot ?? process.cwd();
  const defaults: SettingsPaths = {
    global: path.join(home, ".rookie", "settings.json"),
    project: path.join(projectRoot, ".rookie", "settings.json"),
    local: path.join(projectRoot, ".rookie", "settings.local.json"),
  };
  return { ...defaults, ...(opts.paths ?? {}) };
}

async function readLayer(filePath: string): Promise<LoadedLayer> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as RookieSettings;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { path: filePath, data: {}, exists: true };
    }
    return { path: filePath, data: parsed, exists: true };
  } catch {
    // File missing OR JSON parse failure → treat as empty. We intentionally
    // swallow parse errors so a malformed local file can never brick the
    // whole agent; callers that care can inspect `exists` + re-read.
    return { path: filePath, data: {}, exists: false };
  }
}

/**
 * Deep-merge settings with the following rules:
 *   - Arrays of objects are concatenated with `higher` prepended and
 *     de-duped by JSON identity. This preserves "first match wins" semantics
 *     for permissions and hooks without silently dropping project defaults.
 *   - Plain objects are recursively merged; keys in `higher` take priority.
 *   - Scalars from `higher` always overwrite `lower`.
 *   - `undefined` on `higher` never erases `lower`.
 */
export function deepMerge<T extends Record<string, unknown>>(lower: T, higher: T): T {
  const out: Record<string, unknown> = { ...lower };
  for (const key of Object.keys(higher)) {
    const hv = (higher as Record<string, unknown>)[key];
    if (hv === undefined) continue;
    const lv = out[key];
    if (Array.isArray(hv) && Array.isArray(lv)) {
      // Prepend higher-priority entries, then append lower-priority entries
      // that haven't appeared yet (dedup via JSON identity — cheap and good
      // enough for our rule-sized arrays).
      const seen = new Set<string>();
      const merged: unknown[] = [];
      for (const entry of [...hv, ...lv]) {
        const key2 = safeJsonKey(entry);
        if (seen.has(key2)) continue;
        seen.add(key2);
        merged.push(entry);
      }
      out[key] = merged;
    } else if (isPlainObject(hv) && isPlainObject(lv)) {
      out[key] = deepMerge(lv as Record<string, unknown>, hv as Record<string, unknown>);
    } else {
      out[key] = hv;
    }
  }
  return out as T;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeJsonKey(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/**
 * Load the three layers and return both the merged view and the per-layer
 * breakdown. Missing files are treated as empty rather than errors, which
 * matches how Claude Code / VS Code behave.
 */
export async function loadSettings(opts: LoadSettingsOptions = {}): Promise<MergedSettings> {
  const paths = resolveSettingsPaths(opts);
  const [global, project, local] = await Promise.all([
    readLayer(paths.global),
    readLayer(paths.project),
    readLayer(paths.local),
  ]);

  // Merge order: global → project → local (each step "higher" beats "lower").
  let merged: RookieSettings = {};
  merged = deepMerge(merged, global.data);
  merged = deepMerge(merged, project.data);
  merged = deepMerge(merged, local.data);

  const origins = computeOrigins(global, project, local);

  return {
    merged,
    layers: { global, project, local },
    origins,
  };
}

function computeOrigins(
  global: LoadedLayer,
  project: LoadedLayer,
  local: LoadedLayer,
): Partial<Record<keyof RookieSettings, SettingsLayer>> {
  const origins: Partial<Record<keyof RookieSettings, SettingsLayer>> = {};
  const order: Array<[SettingsLayer, LoadedLayer]> = [
    ["global", global],
    ["project", project],
    ["local", local],
  ];
  // Higher-priority layers override earlier ones; iterate in priority order
  // so the last assignment wins — that mirrors deepMerge's behaviour.
  for (const [layer, lo] of order) {
    for (const key of Object.keys(lo.data)) {
      origins[key as keyof RookieSettings] = layer;
    }
  }
  return origins;
}
