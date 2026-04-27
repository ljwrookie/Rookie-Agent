import { exec } from "child_process";
import { promisify } from "util";
import { Tool } from "../types.js";

const execAsync = promisify(exec);

// ─── Shared helpers ─────────────────────────────────────────

interface RunOptions {
  cwd?: string;
  timeout?: number;
}

async function runGit(args: string, opts: RunOptions = {}): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const timeout = opts.timeout ?? 30_000;
  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd,
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    return (stdout + (stderr ? `\n[stderr] ${stderr}` : "")).trim();
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string; code?: number };
    const out = [err.stdout, err.stderr, err.message].filter(Boolean).join("\n").trim();
    return `[ERROR] git ${args} exited with code ${err.code ?? "?"}:\n${out}`;
  }
}

// Reject arguments that look like an injection attempt. We allow
// common safe characters: alphanumerics, dash, dot, underscore, slash,
// colon, space, equals, `@`, `~`, and quoted strings. Callers must
// pass `message` separately and we'll single-quote-escape it.
const SAFE_REF_RE = /^[\w./\-@:~]+$/;

function guardRef(ref: string): string | null {
  if (!ref) return "empty ref";
  if (!SAFE_REF_RE.test(ref)) return `unsafe ref: ${ref}`;
  return null;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ─── Original tools (kept for compatibility) ────────────────

export const gitStatusTool: Tool = {
  name: "git_status",
  description: "Get git status.",
  parameters: [
    { name: "cwd", type: "string", description: "Working directory", required: false },
    { name: "porcelain", type: "boolean", description: "Use porcelain output (default true)", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : undefined;
    const porcelain = params.porcelain === undefined ? true : Boolean(params.porcelain);
    return runGit(porcelain ? "status --porcelain=v1 --branch" : "status", { cwd });
  },
};

export const gitDiffTool: Tool = {
  name: "git_diff",
  description: "Show git diff for unstaged or specific changes.",
  parameters: [
    { name: "cwd", type: "string", description: "Working directory", required: false },
    { name: "file", type: "string", description: "Specific file", required: false },
    { name: "staged", type: "boolean", description: "Show staged diff (default false)", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : undefined;
    const file = params.file ? String(params.file) : "";
    const staged = Boolean(params.staged);
    if (file) {
      const bad = guardRef(file);
      if (bad) return `[ERROR] ${bad}`;
    }
    const args = [staged ? "diff --cached" : "diff", file].filter(Boolean).join(" ");
    return runGit(args, { cwd });
  },
};

// ─── New tools ──────────────────────────────────────────────

export const gitCommitTool: Tool = {
  name: "git_commit",
  description:
    "Create a git commit with the given message. " +
    "If `addAll` is true (default), stages all changes first.",
  parameters: [
    { name: "message", type: "string", description: "Commit message", required: true },
    { name: "cwd", type: "string", description: "Working directory", required: false },
    { name: "addAll", type: "boolean", description: "Stage all before commit (default true)", required: false },
    { name: "allowEmpty", type: "boolean", description: "Allow empty commit", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : undefined;
    const addAll = params.addAll === undefined ? true : Boolean(params.addAll);
    const allowEmpty = Boolean(params.allowEmpty);
    const message = String(params.message);
    if (!message.trim()) return "[ERROR] commit message is empty";

    if (addAll) {
      const added = await runGit("add -A", { cwd });
      if (added.startsWith("[ERROR]")) return added;
    }
    const flags = allowEmpty ? "--allow-empty" : "";
    return runGit(`commit ${flags} -m ${shellQuote(message)}`.trim(), { cwd });
  },
};

export const gitBranchTool: Tool = {
  name: "git_branch",
  description:
    "List, create, or delete branches. Actions: 'list' (default), 'create', 'delete'.",
  parameters: [
    { name: "action", type: "string", description: "list | create | delete", required: false },
    { name: "name", type: "string", description: "Branch name (for create/delete)", required: false },
    { name: "from", type: "string", description: "Source ref for create (default HEAD)", required: false },
    { name: "force", type: "boolean", description: "Force delete", required: false },
    { name: "cwd", type: "string", description: "Working directory", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : undefined;
    const action = (params.action ? String(params.action) : "list").toLowerCase();
    if (action === "list") {
      return runGit("branch --list --all --no-color", { cwd });
    }
    const name = params.name ? String(params.name) : "";
    const bad = guardRef(name);
    if (bad) return `[ERROR] ${bad}`;
    if (action === "create") {
      const from = params.from ? String(params.from) : "";
      if (from) {
        const badFrom = guardRef(from);
        if (badFrom) return `[ERROR] ${badFrom}`;
      }
      return runGit(`branch ${name} ${from}`.trim(), { cwd });
    }
    if (action === "delete") {
      const flag = params.force ? "-D" : "-d";
      return runGit(`branch ${flag} ${name}`, { cwd });
    }
    return `[ERROR] unknown action "${action}"`;
  },
};

export const gitLogTool: Tool = {
  name: "git_log",
  description: "Show git log with a concise, machine-readable format.",
  parameters: [
    { name: "cwd", type: "string", description: "Working directory", required: false },
    { name: "limit", type: "number", description: "Max entries (default 20)", required: false },
    { name: "file", type: "string", description: "Restrict to a file", required: false },
    { name: "grep", type: "string", description: "Filter commits by message pattern", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : undefined;
    const limit = typeof params.limit === "number" ? params.limit : 20;
    const file = params.file ? String(params.file) : "";
    const grep = params.grep ? String(params.grep) : "";
    if (file) {
      const bad = guardRef(file);
      if (bad) return `[ERROR] ${bad}`;
    }
    const grepArg = grep ? `--grep=${shellQuote(grep)}` : "";
    const args = [
      "log",
      `-n ${limit}`,
      `--pretty=format:${shellQuote("%h %ad %an %s")}`,
      "--date=short",
      grepArg,
      file ? `-- ${file}` : "",
    ].filter(Boolean).join(" ");
    return runGit(args, { cwd });
  },
};

export const gitCheckoutTool: Tool = {
  name: "git_checkout",
  description:
    "Check out a ref (branch / commit / tag). Optionally create the branch if it does not exist.",
  parameters: [
    { name: "ref", type: "string", description: "Ref to check out", required: true },
    { name: "create", type: "boolean", description: "Create branch if missing", required: false },
    { name: "cwd", type: "string", description: "Working directory", required: false },
  ],
  async execute(params) {
    const ref = String(params.ref);
    const bad = guardRef(ref);
    if (bad) return `[ERROR] ${bad}`;
    const cwd = params.cwd ? String(params.cwd) : undefined;
    const flag = params.create ? "-b" : "";
    return runGit(`checkout ${flag} ${ref}`.trim(), { cwd });
  },
};

export const gitWorktreeTool: Tool = {
  name: "git_worktree",
  description:
    "Manage git worktrees. Actions: 'list' (default), 'add', 'remove'.",
  parameters: [
    { name: "action", type: "string", description: "list | add | remove", required: false },
    { name: "path", type: "string", description: "Worktree path (for add/remove)", required: false },
    { name: "ref", type: "string", description: "Ref for add (default HEAD)", required: false },
    { name: "force", type: "boolean", description: "Force remove", required: false },
    { name: "cwd", type: "string", description: "Working directory", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : undefined;
    const action = (params.action ? String(params.action) : "list").toLowerCase();
    if (action === "list") return runGit("worktree list", { cwd });

    const wtPath = params.path ? String(params.path) : "";
    if (!wtPath) return "[ERROR] path is required";
    // Path may contain spaces — always quote.
    const quoted = shellQuote(wtPath);

    if (action === "add") {
      const ref = params.ref ? String(params.ref) : "";
      if (ref) {
        const bad = guardRef(ref);
        if (bad) return `[ERROR] ${bad}`;
      }
      return runGit(`worktree add ${quoted} ${ref}`.trim(), { cwd });
    }
    if (action === "remove") {
      const flag = params.force ? "--force" : "";
      return runGit(`worktree remove ${flag} ${quoted}`.trim(), { cwd });
    }
    return `[ERROR] unknown action "${action}"`;
  },
};

// Test helpers
export const __test__ = { guardRef, shellQuote };
