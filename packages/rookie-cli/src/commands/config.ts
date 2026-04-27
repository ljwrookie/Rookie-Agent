// `rookie config` — inspect the merged three-tier settings view.
// Writes go through the specific commands (`rookie hook`, `rookie permission`)
// so this module is read-only on purpose.

import {
  loadSettings,
  resolveSettingsPaths,
  type MergedSettings,
  type SettingsLayer,
} from "@rookie/agent-sdk";
import * as path from "node:path";

export interface ConfigShowOptions {
  projectRoot?: string;
  home?: string;
  format?: "text" | "json";
  /** When set, only that single layer is reported instead of the merged view. */
  layer?: SettingsLayer;
}

/**
 * Entry point for `rookie config`. Returns an exit code so callers in tests
 * don't have to trap process.exit().
 */
export async function runConfigShow(opts: ConfigShowOptions): Promise<number> {
  const result = await loadSettings({
    projectRoot: opts.projectRoot,
    home: opts.home,
  });

  if (opts.format === "json") {
    return emitJson(result, opts);
  }

  if (opts.layer) {
    const layer = result.layers[opts.layer];
    console.log(`# ${opts.layer.toUpperCase()} — ${layer.path}${layer.exists ? "" : "  (not found)"}`);
    console.log(JSON.stringify(layer.data, null, 2));
    return 0;
  }

  printTextView(result, opts);
  return 0;
}

function emitJson(result: MergedSettings, opts: ConfigShowOptions): number {
  const payload = opts.layer
    ? { layer: opts.layer, ...result.layers[opts.layer] }
    : {
        merged: result.merged,
        origins: result.origins,
        layers: result.layers,
      };
  console.log(JSON.stringify(payload, null, 2));
  return 0;
}

function printTextView(result: MergedSettings, opts: ConfigShowOptions): void {
  const { layers, merged, origins } = result;
  const paths = resolveSettingsPaths({
    projectRoot: opts.projectRoot,
    home: opts.home,
  });

  console.log("Rookie settings (precedence: local > project > global)\n");

  const rel = (p: string) => {
    const cwd = opts.projectRoot ?? process.cwd();
    const r = path.relative(cwd, p);
    return r && !r.startsWith("..") ? r : p;
  };

  console.log(`  global   ${rel(paths.global)}  ${layers.global.exists ? "✓" : "✗ (missing)"}`);
  console.log(`  project  ${rel(paths.project)}  ${layers.project.exists ? "✓" : "✗ (missing)"}`);
  console.log(`  local    ${rel(paths.local)}  ${layers.local.exists ? "✓" : "✗ (missing)"}`);

  const keys = Object.keys(merged);
  if (keys.length === 0) {
    console.log("\nNo settings defined yet.");
    return;
  }

  console.log("\nMerged view (← marks the winning layer per key):");
  for (const key of keys) {
    const source = origins[key as keyof typeof origins] ?? "default";
    const value = merged[key];
    const rendered = formatValue(value);
    console.log(`  • ${key}  ← ${source}`);
    for (const line of rendered) console.log(`      ${line}`);
  }
}

function formatValue(value: unknown): string[] {
  if (value === undefined) return ["undefined"];
  const json = JSON.stringify(value, null, 2);
  return json.split("\n");
}
