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

// D2: Worktree isolation tools

export interface WorktreeEntry {
  path: string;
  head: string;
  branch: string;
  bare: boolean;
}

/**
 * Parse git worktree list output into structured entries.
 */
function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  const lines = output.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    // Format: path head [branch] [bare]
    const match = line.match(/^(\S+)\s+(\S+)(?:\s+\[(.+?)\])?(?:\s+(bare))?/);
    if (match) {
      entries.push({
        path: match[1],
        head: match[2],
        branch: match[3] || "",
        bare: match[4] === "bare",
      });
    }
  }
  return entries;
}

/**
 * EnterWorktree: Create and enter a git worktree for isolated task execution.
 * D2: Worktree isolation with fail-closed policy.
 */
export const enterWorktreeTool: Tool = {
  name: "enter_worktree",
  description:
    "Create a git worktree for isolated task execution. " +
    "Returns the worktree path on success. " +
    "Fail-closed: if worktree creation fails, the task should abort.",
  parameters: [
    { name: "slug", type: "string", description: "Unique identifier for this worktree", required: true },
    { name: "branch", type: "string", description: "Branch to create worktree from (default: current branch)", required: false },
    { name: "sparsePaths", type: "array", description: "Paths for sparse checkout (only checkout these directories)", required: false },
    { name: "cwd", type: "string", description: "Git repository root", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : process.cwd();
    const slug = String(params.slug);
    const branch = params.branch ? String(params.branch) : "";
    const sparsePaths = Array.isArray(params.sparsePaths) ? params.sparsePaths.map(String) : [];

    if (!slug) return "[ERROR] slug is required";

    // Validate slug (alphanumeric, dash, underscore only)
    if (!/^[\w-]+$/.test(slug)) {
      return `[ERROR] Invalid slug: ${slug}. Use alphanumeric, dash, underscore only.`;
    }

    const worktreePath = `.rookie/worktrees/${slug}`;
    const branchName = `rookie/${slug}`;

    try {
      // Check if we're in a git repo
      const gitCheck = await runGit("rev-parse --git-dir", { cwd });
      if (gitCheck.startsWith("[ERROR]")) {
        return `[ERROR] Not a git repository: ${cwd}`;
      }

      // Create worktree directory if needed
      const fs = await import("fs/promises");
      const path = await import("path");
      const fullWorktreePath = path.resolve(cwd, worktreePath);

      // Check if worktree already exists
      const existing = await runGit("worktree list", { cwd });
      if (existing.includes(fullWorktreePath)) {
        return `[ERROR] Worktree already exists at ${worktreePath}`;
      }

      // Create worktree with new branch
      const baseRef = branch || "HEAD";
      const createResult = await runGit(
        `worktree add -b ${branchName} ${shellQuote(worktreePath)} ${baseRef}`,
        { cwd }
      );

      if (createResult.startsWith("[ERROR]")) {
        return `[ERROR] Failed to create worktree: ${createResult}`;
      }

      // Configure sparse checkout if paths specified
      if (sparsePaths.length > 0) {
        const wtCwd = fullWorktreePath;

        // Enable sparse checkout
        const sparseEnable = await runGit("sparse-checkout init --cone", { cwd: wtCwd });
        if (sparseEnable.startsWith("[ERROR]")) {
          // Cleanup on failure (fail-closed)
          await runGit(`worktree remove ${shellQuote(worktreePath)} --force`, { cwd });
          return `[ERROR] Failed to enable sparse checkout: ${sparseEnable}`;
        }

        // Set sparse paths
        const sparseSet = await runGit(
          `sparse-checkout set ${sparsePaths.map(shellQuote).join(" ")}`,
          { cwd: wtCwd }
        );
        if (sparseSet.startsWith("[ERROR]")) {
          // Cleanup on failure (fail-closed)
          await runGit(`worktree remove ${shellQuote(worktreePath)} --force`, { cwd });
          return `[ERROR] Failed to set sparse paths: ${sparseSet}`;
        }
      }

      // Record worktree metadata
      const metadataPath = path.join(fullWorktreePath, ".rookie", "worktree.json");
      await fs.mkdir(path.dirname(metadataPath), { recursive: true });
      await fs.writeFile(
        metadataPath,
        JSON.stringify({
          slug,
          createdAt: Date.now(),
          branch: branchName,
          baseRef,
          sparsePaths,
          parentCwd: cwd,
        }, null, 2)
      );

      return JSON.stringify({
        success: true,
        worktreePath,
        fullPath: fullWorktreePath,
        branch: branchName,
        sparseCheckout: sparsePaths.length > 0,
      });
    } catch (e) {
      // Fail-closed: any error aborts
      return `[ERROR] Worktree creation failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

/**
 * ExitWorktree: Remove worktree and optionally cherry-pick changes back.
 * D2: Worktree cleanup with change merging.
 */
export const exitWorktreeTool: Tool = {
  name: "exit_worktree",
  description:
    "Remove a git worktree and optionally cherry-pick changes back to the main branch. " +
    "Use this after task completion to clean up isolated worktrees.",
  parameters: [
    { name: "slug", type: "string", description: "Worktree identifier", required: true },
    { name: "cherryPick", type: "boolean", description: "Cherry-pick changes back to main branch", required: false },
    { name: "commitMessage", type: "string", description: "Commit message for cherry-pick", required: false },
    { name: "cwd", type: "string", description: "Git repository root", required: false },
    { name: "force", type: "boolean", description: "Force remove even with uncommitted changes", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : process.cwd();
    const slug = String(params.slug);
    const cherryPick = Boolean(params.cherryPick);
    const commitMessage = params.commitMessage ? String(params.commitMessage) : `Changes from worktree ${slug}`;
    const force = Boolean(params.force);

    if (!slug) return "[ERROR] slug is required";

    const worktreePath = `.rookie/worktrees/${slug}`;
    const branchName = `rookie/${slug}`;

    try {
      const path = await import("path");
      const fullWorktreePath = path.resolve(cwd, worktreePath);

      // Check if worktree exists
      const existing = await runGit("worktree list", { cwd });
      if (!existing.includes(fullWorktreePath)) {
        return `[ERROR] Worktree not found: ${worktreePath}`;
      }

      let cherryPickedCommit: string | null = null;

      // Cherry-pick changes if requested
      if (cherryPick) {
        // Check for changes in worktree
        const status = await runGit("status --porcelain", { cwd: fullWorktreePath });
        const hasChanges = status.trim().length > 0;

        if (hasChanges) {
          // Commit changes in worktree
          const addResult = await runGit("add -A", { cwd: fullWorktreePath });
          if (addResult.startsWith("[ERROR]")) {
            return `[ERROR] Failed to stage changes: ${addResult}`;
          }

          const commitResult = await runGit(
            `commit -m ${shellQuote(commitMessage)}`,
            { cwd: fullWorktreePath }
          );
          if (commitResult.startsWith("[ERROR]")) {
            return `[ERROR] Failed to commit changes: ${commitResult}`;
          }

          // Get the commit hash
          const hashResult = await runGit("rev-parse HEAD", { cwd: fullWorktreePath });
          cherryPickedCommit = hashResult.trim();

          // Cherry-pick to main worktree
          const cherryResult = await runGit(`cherry-pick ${cherryPickedCommit}`, { cwd });
          if (cherryResult.startsWith("[ERROR]")) {
            return `[ERROR] Failed to cherry-pick changes: ${cherryResult}. Resolve conflicts manually.`;
          }
        }
      }

      // Remove worktree
      const removeResult = await runGit(
        `worktree remove ${shellQuote(worktreePath)} ${force ? "--force" : ""}`.trim(),
        { cwd }
      );

      if (removeResult.startsWith("[ERROR]")) {
        return `[ERROR] Failed to remove worktree: ${removeResult}`;
      }

      // Clean up the branch if it still exists
      const branchList = await runGit("branch --list", { cwd });
      if (branchList.includes(branchName)) {
        await runGit(`branch -D ${branchName}`, { cwd });
      }

      return JSON.stringify({
        success: true,
        worktreePath,
        cherryPicked: cherryPickedCommit !== null,
        commitHash: cherryPickedCommit,
      });
    } catch (e) {
      return `[ERROR] Worktree cleanup failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

/**
 * CountWorktreeChanges: Count changes in a worktree (for monitoring).
 * D2: Worktree change tracking.
 */
export const countWorktreeChangesTool: Tool = {
  name: "count_worktree_changes",
  description: "Count the number of changed files in a worktree.",
  parameters: [
    { name: "slug", type: "string", description: "Worktree identifier", required: true },
    { name: "cwd", type: "string", description: "Git repository root", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : process.cwd();
    const slug = String(params.slug);

    if (!slug) return "[ERROR] slug is required";

    const worktreePath = `.rookie/worktrees/${slug}`;

    try {
      const path = await import("path");
      const fullWorktreePath = path.resolve(cwd, worktreePath);

      // Check if worktree exists
      const existing = await runGit("worktree list", { cwd });
      if (!existing.includes(fullWorktreePath)) {
        return `[ERROR] Worktree not found: ${worktreePath}`;
      }

      // Count changes
      const status = await runGit("status --porcelain", { cwd: fullWorktreePath });
      const lines = status.split("\n").filter((l) => l.trim());

      const staged = lines.filter((l) => l.startsWith("A") || l.startsWith("M") || l.startsWith("D")).length;
      const unstaged = lines.filter((l) => l.startsWith(" ") || l.startsWith("?")).length;

      return JSON.stringify({
        worktreePath,
        totalChanges: lines.length,
        staged,
        unstaged,
        hasChanges: lines.length > 0,
      });
    } catch (e) {
      return `[ERROR] Failed to count changes: ${e instanceof Error ? e.message : String(e)}`;
    }
  },
};

// Test helpers
export const __test__ = { guardRef, shellQuote, parseWorktreeList };
