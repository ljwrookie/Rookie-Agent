import { SessionHarness, type Feature } from "@rookie/agent-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface VerifyOptions {
  projectRoot?: string;
  featureId?: string;
  /** If set, fail fast on first failure instead of running remaining checks. */
  bail?: boolean;
}

/**
 * `rookie verify [--feature id] [--bail]`
 *
 * Runs `verifyCommand` for each feature in `.rookie/features.json`. If
 * `--feature` is given, only that feature is verified. Exit code is 0 iff
 * every selected feature passes.
 */
export async function runVerify(opts: VerifyOptions): Promise<number> {
  const root = opts.projectRoot ?? process.cwd();
  const featuresPath = path.join(root, ".rookie", "features.json");

  let features: Feature[];
  try {
    const raw = await fs.readFile(featuresPath, "utf-8");
    const list = JSON.parse(raw) as { features: Feature[] };
    features = list.features ?? [];
  } catch (e) {
    console.error(`Error: cannot read ${featuresPath}: ${(e as Error).message}`);
    return 1;
  }

  const selected = opts.featureId
    ? features.filter((f) => f.id === opts.featureId)
    : features;
  if (selected.length === 0) {
    console.error(
      opts.featureId
        ? `Error: no feature with id "${opts.featureId}" found.`
        : "Error: features.json has no features to verify.",
    );
    return 1;
  }

  const harness = new SessionHarness({ projectRoot: root });
  let anyFailed = false;

  for (const feature of selected) {
    if (!feature.verifyCommand) {
      console.log(`○ ${feature.id}  (skipped — no verifyCommand)`);
      continue;
    }
    const result = await harness.verify(feature);
    const mark = result.passed ? "✓" : "✗";
    console.log(`${mark} ${feature.id}  (${result.duration}ms)  ${feature.description}`);
    if (!result.passed) {
      anyFailed = true;
      const snippet = result.output.split("\n").slice(0, 8).join("\n");
      console.log(snippet.split("\n").map((l) => "    " + l).join("\n"));
      if (opts.bail) break;
    }
  }

  return anyFailed ? 1 : 0;
}
