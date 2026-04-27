import { execSync } from "child_process";
import * as path from "path";
import * as fs from "fs";
import { fileURLToPath } from "url";

// ESM-compatible __dirname
const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);

/**
 * Resolve the path to the rookie-core binary.
 * Priority:
 *   1. ROOKIE_CORE_BIN environment variable
 *   2. `which rookie-core` (PATH lookup)
 *   3. Relative to project root (development mode)
 */
export function resolveCoreBinary(): string {
  // 1. Env var
  const envBin = process.env.ROOKIE_CORE_BIN;
  if (envBin && fs.existsSync(envBin)) {
    return envBin;
  }

  // 2. PATH lookup
  try {
    const whichResult = execSync("which rookie-core", { encoding: "utf-8" }).trim();
    if (whichResult && fs.existsSync(whichResult)) {
      return whichResult;
    }
  } catch {
    // not in PATH, continue
  }

  // 3. Relative path: walk up from this file to find project root (has Cargo.toml)
  let dir = __dirname_esm;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "target", "release", "rookie-core");
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const debugCandidate = path.join(dir, "target", "debug", "rookie-core");
    if (fs.existsSync(debugCandidate)) {
      return debugCandidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: just use the name and hope it's in PATH
  return "rookie-core";
}
