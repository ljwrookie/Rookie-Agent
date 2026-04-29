// Glob tool - Rust-powered file pattern matching
// Uses rookie-core's high-performance glob engine

import { Tool } from "../types.js";

// Import Rust bindings (fallback to JS implementation if not available)
let rustGlobMatch: typeof import("../../transport/napi.js").globMatch | undefined;

try {
  const napi = await import("../../transport/napi.js");
  rustGlobMatch = napi.globMatch;
} catch {
  // Rust bindings not available, will use fallback
}

// =============================================================================
// Rust-Powered Glob Tool
// =============================================================================

/**
 * glob_files — List files matching a glob pattern using Rust engine
 *
 * Features:
 * - High-performance parallel matching
 * - Full glob syntax: **\/\*, {a,b}, ?, [!...]
 * - Automatic .gitignore / .rookieignore handling
 * - Pagination support (offset/limit)
 */
export const globFilesTool: Tool = {
  name: "glob_files",
  description:
    "List files matching a glob pattern (e.g. `src/**/*.ts`). " +
    "Uses high-performance Rust engine with full glob syntax support. " +
    "Respects default ignore set (node_modules/.git/dist/target/...). " +
    "Returns newline-delimited relative paths.",
  parameters: [
    { name: "pattern", type: "string", description: "Glob pattern to match (e.g., 'src/**/*.ts')", required: true },
    { name: "path", type: "string", description: "Directory to search in (default: current working directory)", required: false },
    { name: "limit", type: "number", description: "Maximum number of results to return (default: 500)", required: false },
    { name: "offset", type: "number", description: "Number of results to skip (for pagination)", required: false },
    { name: "hidden", type: "boolean", description: "Include hidden files (default: false)", required: false },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    const pattern = String(params.pattern);
    const cwd = String(params.path ?? params.cwd ?? process.cwd());
    const limit = typeof params.limit === "number" ? params.limit : 500;
    const offset = typeof params.offset === "number" ? params.offset : 0;
    const hidden = params.hidden === true;

    // Use Rust engine if available
    if (rustGlobMatch) {
      try {
        const results = rustGlobMatch({
          path: cwd,
          pattern,
          limit,
          offset,
          hidden,
        });

        if (results.length === 0) {
          return `No files match "${pattern}"`;
        }

        const paths = results.map(r => r.path);
        let output = paths.join("\n");

        // Add pagination info if applicable
        if (results.length >= limit) {
          output += `\n\n[Showing ${results.length} results]`;
          output += ` (use offset: ${offset + limit} for more)`;
        }

        return output;
      } catch (error) {
        // Fall through to JS implementation on error
        console.warn(`Rust glob failed, falling back to JS: ${error}`);
      }
    }

    // Fallback to JS implementation
    return fallbackGlobMatch({
      pattern,
      cwd,
      limit,
      offset,
      hidden,
    });
  },
};

// =============================================================================
// Fallback JS Implementation
// =============================================================================

import { readdir } from "node:fs/promises";
import * as path from "node:path";

const DEFAULT_IGNORES = new Set([
  "node_modules", ".git", "target", "dist", "build",
  ".next", ".turbo", ".cache", "__pycache__", ".venv",
]);

interface WalkOptions {
  root: string;
  ignore?: Set<string>;
  maxFiles?: number;
  hidden?: boolean;
}

async function* walkFiles(opts: WalkOptions): AsyncGenerator<string> {
  const ignore = opts.ignore ?? DEFAULT_IGNORES;
  const max = opts.maxFiles ?? 20_000;
  const stack: string[] = [opts.root];
  let count = 0;

  while (stack.length > 0 && count < max) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      // Skip hidden files unless explicitly included
      if (!opts.hidden && e.name.startsWith(".")) continue;
      if (ignore.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile()) {
        yield full;
        count++;
        if (count >= max) return;
      }
    }
  }
}

export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i += 2;
        if (glob[i] === "/") i++;
      } else {
        re += "[^/]*";
        i++;
      }
    } else if (c === "?") {
      re += "[^/]";
      i++;
    } else if (c === ".") {
      re += "\\.";
      i++;
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end === -1) {
        re += "\\{";
        i++;
      } else {
        const alts = glob.slice(i + 1, end).split(",").map((a) => a.trim());
        re += "(?:" + alts.map((a) => a.replace(/[.+^$()|\\]/g, (m) => "\\" + m)).join("|") + ")";
        i = end + 1;
      }
    } else if ("+^$()|\\".includes(c)) {
      re += "\\" + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  return new RegExp(`^${re}$`);
}

interface FallbackGlobOptions {
  pattern: string;
  cwd: string;
  limit: number;
  offset: number;
  hidden: boolean;
}

async function fallbackGlobMatch(options: FallbackGlobOptions): Promise<string> {
  const { pattern, cwd, limit, offset, hidden } = options;

  const re = globToRegExp(pattern);
  const matches: string[] = [];

  for await (const file of walkFiles({ root: cwd, hidden })) {
    const rel = path.relative(cwd, file);
    if (re.test(rel)) {
      matches.push(rel);
    }
  }

  if (matches.length === 0) {
    return `No files match "${pattern}"`;
  }

  // Apply offset and limit
  const total = matches.length;
  const paginated = matches.slice(offset, offset + limit);

  let result = paginated.join("\n");

  // Add pagination info if applicable
  if (offset > 0 || paginated.length < total) {
    result += `\n\n[Showing ${paginated.length} of ${total} matches]`;
    if (offset + paginated.length < total) {
      result += ` (use offset: ${offset + paginated.length} for more)`;
    }
  }

  return result;
}

// Re-export for tests
export const __test__ = { globToRegExp, walkFiles };

// Compatibility re-export: older tests/importers load both glob+grep from this module.
export { grepFilesTool } from "./grep.js";
