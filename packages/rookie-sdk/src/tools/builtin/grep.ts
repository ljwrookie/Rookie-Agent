// Grep tool - Rust-powered content search
// Uses rookie-core's high-performance grep engine

import { Tool } from "../types.js";

// Import Rust bindings (fallback to JS implementation if not available)
let rustGrepSearch: typeof import("../../transport/napi.js").grepSearch | undefined;

try {
  const napi = await import("../../transport/napi.js");
  rustGrepSearch = napi.grepSearch;
} catch {
  // Rust bindings not available, will use fallback
}

// =============================================================================
// Rust-Powered Grep Tool
// =============================================================================

/**
 * `grep_files` — Search file contents using Rust-powered regex engine
 *
 * Features:
 * - High-performance parallel search (10K files < 50ms)
 * - Automatic .gitignore / .rookieignore handling
 * - Regex and literal search modes
 * - Pagination support (offset/limit)
 */
export const grepFilesTool: Tool = {
  name: "grep_files",
  description:
    "Search file contents for a regex pattern using high-performance Rust engine. " +
    "Returns lines in `path:line:content` format. " +
    "Skips binary files and common build dirs. " +
    "Supports file glob filtering and regex flags.",
  parameters: [
    { name: "pattern", type: "string", description: "Regex pattern to search for", required: true },
    { name: "path", type: "string", description: "Directory to search in (default: current working directory)", required: false },
    { name: "glob", type: "string", description: "File glob filter (e.g., '**/*.ts')", required: false },
    { name: "output", type: "string", description: "Output format: 'content' (default) or 'files' (just file paths)", required: false },
    { name: "limit", type: "number", description: "Maximum number of matches (default: 200)", required: false },
    { name: "offset", type: "number", description: "Number of matches to skip (for pagination)", required: false },
    { name: "caseInsensitive", type: "boolean", description: "Case insensitive search (default: true)", required: false },
    { name: "literal", type: "boolean", description: "Use literal search instead of regex (default: false)", required: false },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    const pattern = String(params.pattern);
    const cwd = String(params.path ?? params.cwd ?? process.cwd());
    const globFilter = params.glob ? String(params.glob) : undefined;
    const outputFormat = String(params.output ?? "content");
    const limit = typeof params.limit === "number" ? params.limit : 200;
    const offset = typeof params.offset === "number" ? params.offset : 0;
    const caseInsensitive = params.caseInsensitive !== false; // default true
    const literal = params.literal === true; // default false

    // Use Rust engine if available
    if (rustGrepSearch) {
      try {
        const result = rustGrepSearch({
          path: cwd,
          pattern,
          glob: globFilter,
          output: outputFormat,
          limit,
          offset,
          case_insensitive: caseInsensitive,
          literal,
        });

        if (outputFormat === "files") {
          const files = [...new Set(result.matches.map(m => m.path))];
          if (files.length === 0) return `No files match pattern /${pattern}/`;
          return files.join("\n");
        }

        if (result.matches.length === 0) {
          return `No matches for /${pattern}/${caseInsensitive ? "i" : ""}`;
        }

        const lines = result.matches.map(m => `${m.path}:${m.line}:${m.content}`);
        let output = lines.join("\n");

        // Add pagination info
        const total = result.files_searched;
        if (offset > 0 || result.matches.length >= limit) {
          output += `\n\n[Showing ${result.matches.length} matches from ${total} files searched in ${result.duration_ms}ms]`;
          if (result.matches.length >= limit) {
            output += ` (use offset: ${offset + limit} for more)`;
          }
        }

        return output;
      } catch (error) {
        // Fall through to JS implementation on error
        console.warn(`Rust grep failed, falling back to JS: ${error}`);
      }
    }

    // Fallback to JS implementation
    return fallbackGrepSearch({
      pattern,
      cwd,
      globFilter,
      outputFormat,
      limit,
      offset,
      caseInsensitive,
      literal,
    });
  },
};

// =============================================================================
// Fallback JS Implementation
// =============================================================================

import { readdir, stat, readFile } from "node:fs/promises";
import * as path from "node:path";

const DEFAULT_IGNORES = new Set([
  "node_modules", ".git", "target", "dist", "build",
  ".next", ".turbo", ".cache", "__pycache__", ".venv",
]);

interface WalkOptions {
  root: string;
  ignore?: Set<string>;
  maxFiles?: number;
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

function globToRegExp(glob: string): RegExp {
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

interface FallbackGrepOptions {
  pattern: string;
  cwd: string;
  globFilter?: string;
  outputFormat: string;
  limit: number;
  offset: number;
  caseInsensitive: boolean;
  literal: boolean;
}

async function fallbackGrepSearch(options: FallbackGrepOptions): Promise<string> {
  const { pattern, cwd, globFilter, outputFormat, limit, offset, caseInsensitive, literal } = options;

  const flags = caseInsensitive && !literal ? "i" : "";
  let re: RegExp;
  try {
    re = new RegExp(literal ? escapeRegex(pattern) : pattern, flags);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `[ERROR] invalid regex: ${msg}`;
  }

  const globRe = globFilter ? globToRegExp(globFilter) : null;
  const results: string[] = [];
  const matchedFiles = new Set<string>();

  outer: for await (const file of walkFiles({ root: cwd })) {
    const rel = path.relative(cwd, file);
    if (globRe && !globRe.test(rel)) continue;

    // Skip large files and binaries
    let st;
    try {
      st = await stat(file);
    } catch {
      continue;
    }
    if (st.size > 2 * 1024 * 1024) continue;
    if (/\.(png|jpe?g|gif|pdf|zip|tar|gz|lock|bin|exe)$/i.test(rel)) continue;

    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    if (content.indexOf("\u0000") !== -1) continue;

    const lines = content.split("\n");
    let fileMatched = false;

    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        fileMatched = true;
        if (outputFormat === "files") {
          matchedFiles.add(rel);
          break;
        }
        results.push(`${rel}:${i + 1}:${lines[i]}`);
        if (results.length >= offset + limit) break outer;
      }
    }

    if (outputFormat === "files" && fileMatched) {
      matchedFiles.add(rel);
    }
  }

  if (outputFormat === "files") {
    const files = Array.from(matchedFiles);
    if (files.length === 0) return `No files match pattern /${pattern}/`;
    return files.join("\n");
  }

  if (results.length === 0) return `No matches for /${pattern}/${flags}`;

  const paginated = results.slice(offset, offset + limit);
  let result = paginated.join("\n");

  if (offset > 0 || results.length > offset + limit) {
    result += `\n\n[Showing ${paginated.length} of ${results.length} matches]`;
    if (results.length > offset + limit) {
      result += ` (use offset: ${offset + limit} for more)`;
    }
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
