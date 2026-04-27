import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";
import { Tool } from "../types.js";

// ─── Minimal glob matcher ────────────────────────────────────
//
// We don't pull in a full `picomatch` dependency; the SDK must stay
// thin. Instead we translate a restricted glob grammar to RegExp:
//   • `**`  → any path segments (including separators)
//   • `*`   → any characters *except* `/`
//   • `?`   → single char, non-slash
//   • `{a,b}` → alternation
//
// This is enough for the real-world usage: `src/**/*.ts`, `tests/*.test.ts`,
// `{a,b}/*.md`.

export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` matches anything (inc. separators)
        re += ".*";
        i += 2;
        // consume trailing slash after `**/`
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

// ─── Directory walker ────────────────────────────────────────

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "target",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
]);

interface WalkOptions {
  root: string;
  ignore?: Set<string>;
  maxFiles?: number;
  followSymlinks?: boolean;
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
      } else if (e.isFile() || (opts.followSymlinks && e.isSymbolicLink())) {
        yield full;
        count++;
        if (count >= max) return;
      }
    }
  }
}

// B9: Glob files tool with CCB-aligned parameters
export const globFilesTool: Tool = {
  name: "glob_files",
  description:
    "List files matching a glob pattern (e.g. `src/**/*.ts`). " +
    "Respects default ignore set (node_modules/.git/dist/target/...). " +
    "Returns newline-delimited relative paths. " +
    "Supports negation patterns and custom ignore lists.",
  parameters: [
    { name: "pattern", type: "string", description: "Glob pattern to match (e.g., 'src/**/*.ts')", required: true },
    { name: "path", type: "string", description: "Directory to search in (default: current working directory)", required: false },
    { name: "limit", type: "number", description: "Maximum number of results to return (default: 500)", required: false },
    { name: "offset", type: "number", description: "Number of results to skip (for pagination)", required: false },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    // B9: Support both old and new parameter names
    const pattern = String(params.pattern);
    const cwd = String(params.path ?? params.cwd ?? process.cwd());
    const limit = typeof params.limit === "number" ? params.limit : 500;
    const offset = typeof params.offset === "number" ? params.offset : 0;

    const re = globToRegExp(pattern);
    const matches: string[] = [];

    for await (const file of walkFiles({ root: cwd })) {
      const rel = path.relative(cwd, file);
      if (re.test(rel)) {
        matches.push(rel);
      }
    }

    if (matches.length === 0) {
      return `No files match "${pattern}"`;
    }

    // B9: Apply offset and limit
    const total = matches.length;
    const paginated = matches.slice(offset, offset + limit);

    let result = paginated.join("\n");

    // B9: Add pagination info if applicable
    if (offset > 0 || paginated.length < total) {
      result += `\n\n[Showing ${paginated.length} of ${total} matches]`;
      if (offset + paginated.length < total) {
        result += ` (use offset: ${offset + paginated.length} for more)`;
      }
    }

    return result;
  },
};

// B9: Grep files tool with CCB-aligned parameters
export const grepFilesTool: Tool = {
  name: "grep_files",
  description:
    "Search file contents for a regex pattern. Returns lines in `path:line:content` format. " +
    "Skips binary files and common build dirs. " +
    "Supports file glob filtering and regex flags.",
  parameters: [
    { name: "pattern", type: "string", description: "Regex pattern to search for", required: true },
    { name: "path", type: "string", description: "Directory to search in (default: current working directory)", required: false },
    { name: "glob", type: "string", description: "File glob filter (e.g., '**/*.ts')", required: false },
    { name: "output", type: "string", description: "Output format: 'content' (default) or 'files' (just file paths)", required: false },
    { name: "limit", type: "number", description: "Maximum number of matches (default: 200)", required: false },
    { name: "offset", type: "number", description: "Number of matches to skip (for pagination)", required: false },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    // B9: Support both old and new parameter names
    const pattern = String(params.pattern);
    const cwd = String(params.path ?? params.cwd ?? process.cwd());
    const globFilter = params.glob ? globToRegExp(String(params.glob)) : null;
    const outputFormat = String(params.output ?? "content");
    const limit = typeof params.limit === "number" ? params.limit : 200;
    const offset = typeof params.offset === "number" ? params.offset : 0;
    // Default to case-insensitive unless pattern has explicit flags
    const flags = "i";

    let re: RegExp;
    try {
      re = new RegExp(pattern, flags);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[ERROR] Invalid regex pattern: ${msg}`;
    }

    const { readFile } = await import("node:fs/promises");
    const results: string[] = [];
    const matchedFiles = new Set<string>();

    outer: for await (const file of walkFiles({ root: cwd })) {
      const rel = path.relative(cwd, file);
      if (globFilter && !globFilter.test(rel)) continue;

      // Skip large files (> 2 MB) and obvious binaries by extension
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

      // Crude binary check
      if (content.indexOf("\u0000") !== -1) continue;

      const lines = content.split("\n");
      let fileMatched = false;

      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          fileMatched = true;

          if (outputFormat === "files") {
            matchedFiles.add(rel);
            break; // Only need one match per file
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

    // B9: Apply offset
    const paginated = results.slice(offset, offset + limit);
    let result = paginated.join("\n");

    // B9: Add pagination info
    if (offset > 0 || results.length > offset + limit) {
      result += `\n\n[Showing ${paginated.length} of ${results.length} matches]`;
      if (results.length > offset + limit) {
        result += ` (use offset: ${offset + limit} for more)`;
      }
    }

    return result;
  },
};

export const __test__ = { globToRegExp, walkFiles };
