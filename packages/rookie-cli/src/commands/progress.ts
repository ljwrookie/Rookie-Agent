import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface ProgressOptions {
  projectRoot?: string;
  format?: "markdown" | "json";
}

/**
 * `rookie progress [--format markdown|json]`
 *
 * Render `.rookie/progress.md` verbatim (markdown) or as a structured JSON
 * snapshot joining progress + features.
 */
export async function runProgress(opts: ProgressOptions): Promise<number> {
  const root = opts.projectRoot ?? process.cwd();
  const format = opts.format ?? "markdown";

  const progressPath = path.join(root, ".rookie", "progress.md");
  const featuresPath = path.join(root, ".rookie", "features.json");

  try {
    if (format === "markdown") {
      const md = await fs.readFile(progressPath, "utf-8");
      process.stdout.write(md);
      if (!md.endsWith("\n")) process.stdout.write("\n");
      return 0;
    }

    const [md, featuresRaw] = await Promise.all([
      fs.readFile(progressPath, "utf-8").catch(() => ""),
      fs.readFile(featuresPath, "utf-8").catch(() => "{}"),
    ]);
    const features = JSON.parse(featuresRaw || "{}");
    console.log(JSON.stringify({ progress: md, features }, null, 2));
    return 0;
  } catch (e) {
    console.error(`Error: ${(e as Error).message}. Run \`rookie init\` first.`);
    return 1;
  }
}
