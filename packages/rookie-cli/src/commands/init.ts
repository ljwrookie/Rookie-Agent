import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SessionHarness, type Feature } from "@rookie/agent-sdk";

export interface InitOptions {
  projectRoot?: string;
  task?: string;
  featuresFile?: string;
  verifyCommand?: string;
}

/**
 * `rookie init [--task "..."] [--features-file path]`
 *
 * Phase-1 Initializer: decomposes a task into a feature list and seeds
 * `.rookie/progress.md` + `.rookie/features.json`.
 *
 * Features can be provided as:
 *   1. JSON file via `--features-file` (array of Feature or {description} objects)
 *   2. Single-feature task via `--task` (creates one catch-all feature)
 */
export async function runInit(opts: InitOptions): Promise<number> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const task = opts.task?.trim();
  if (!task) {
    console.error("Error: --task <description> is required for `rookie init`");
    return 1;
  }

  let features: Feature[] = [];
  if (opts.featuresFile) {
    try {
      const raw = await fs.readFile(path.resolve(opts.featuresFile), "utf-8");
      const parsed = JSON.parse(raw) as Array<Partial<Feature> & { description: string }>;
      features = parsed.map((f, i) => ({
        id: f.id ?? `f-${i + 1}`,
        description: f.description,
        verifyCommand: f.verifyCommand,
        status: f.status ?? "pending",
        attempts: f.attempts ?? 0,
        lastError: f.lastError,
      }));
    } catch (e) {
      console.error(`Error: failed to read features file: ${(e as Error).message}`);
      return 1;
    }
  } else {
    features = [
      {
        id: "f-1",
        description: task,
        verifyCommand: opts.verifyCommand,
        status: "pending",
        attempts: 0,
      },
    ];
  }

  const harness = new SessionHarness({
    projectRoot,
    verifyCommand: opts.verifyCommand,
  });
  const state = await harness.initialize(task, features);

  console.log(`✓ Initialized session ${state.sessionId}`);
  console.log(`  Phase:           ${state.phase}`);
  console.log(`  Total features:  ${state.totalFeatures}`);
  console.log(`  Progress file:   .rookie/progress.md`);
  console.log(`  Feature list:    .rookie/features.json`);
  return 0;
}
