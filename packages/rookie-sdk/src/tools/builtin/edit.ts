import { readFile, writeFile, rename, unlink, stat } from "fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomBytes } from "node:crypto";
import { Tool } from "../types.js";
import { saveSnapshot } from "../snapshot.js";

// ─── Atomic write helper ─────────────────────────────────────

/**
 * Atomically replace the file at `filePath` with `newContent`.
 *
 * Strategy:
 *   1. Write content to a sibling temp file `path.<rand>.tmp`.
 *   2. If `backup` is true and the target already exists, rename the
 *      current file to `<path>.bak` (overwriting any prior backup).
 *   3. Rename the temp file to `filePath` (atomic on POSIX).
 *
 * The temp file is in the same directory so rename stays within a
 * single filesystem. If anything fails mid-way we try to clean the
 * temp file but keep the `.bak` as recovery artefact.
 */
export async function atomicWrite(
  filePath: string,
  newContent: string,
  opts: { backup?: boolean } = {},
): Promise<{ backupPath?: string }> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempName = `.${base}.${randomBytes(6).toString("hex")}.tmp`;
  const tempPath = path.join(dir, tempName);

  await writeFile(tempPath, newContent, "utf-8");

  let backupPath: string | undefined;
  if (opts.backup) {
    try {
      await stat(filePath);
      backupPath = `${filePath}.bak`;
      // rename overwrites on POSIX; remove on Windows if present.
      try {
        await rename(filePath, backupPath);
      } catch {
        // Target may already exist on some FS: unlink old then rename.
        try { await unlink(backupPath); } catch { /* ignore */ }
        await rename(filePath, backupPath);
      }
    } catch {
      // Original file does not exist — nothing to back up.
    }
  }

  try {
    await rename(tempPath, filePath);
  } catch (e) {
    // Cleanup temp if rename failed.
    try { await unlink(tempPath); } catch { /* ignore */ }
    throw e;
  }

  return { backupPath };
}

// ─── Diff parsing: minimal unified-diff apply ────────────────

/**
 * Parse a single-file unified diff and return the list of hunks with
 * their `context/remove/add` line operations. We intentionally accept
 * only one file's diff per invocation; callers must split multi-file
 * diffs first.
 */
interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  ops: Array<{ kind: "ctx" | "del" | "add"; text: string }>;
}

export function parseUnifiedDiff(diff: string): DiffHunk[] {
  const lines = diff.split(/\r?\n/);
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  const headerRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

  for (const line of lines) {
    if (line.startsWith("--- ") || line.startsWith("+++ ")) continue;
    const m = headerRe.exec(line);
    if (m) {
      current = {
        oldStart: Number(m[1]),
        oldLines: m[2] ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newLines: m[4] ? Number(m[4]) : 1,
        ops: [],
      };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith("+")) current.ops.push({ kind: "add", text: line.slice(1) });
    else if (line.startsWith("-")) current.ops.push({ kind: "del", text: line.slice(1) });
    else if (line.startsWith(" ")) current.ops.push({ kind: "ctx", text: line.slice(1) });
    // Ignore "\ No newline at end of file" markers.
  }
  return hunks;
}

/**
 * Apply a unified diff to `source` and return the patched string.
 * Strict matching: we require context & removed lines to match exactly
 * (the caller can normalise EOLs before invoking).
 */
export function applyUnifiedDiff(source: string, diff: string): string {
  const hunks = parseUnifiedDiff(diff);
  if (hunks.length === 0) {
    throw new Error("applyUnifiedDiff: no hunks found in diff");
  }
  const srcLines = source.split("\n");
  const outLines: string[] = [];
  let srcIdx = 0; // 0-based

  for (const hunk of hunks) {
    const targetStart = hunk.oldStart - 1; // convert to 0-based
    // Copy untouched lines before the hunk.
    while (srcIdx < targetStart) {
      outLines.push(srcLines[srcIdx]);
      srcIdx++;
    }
    for (const op of hunk.ops) {
      if (op.kind === "ctx") {
        if (srcLines[srcIdx] !== op.text) {
          throw new Error(
            `applyUnifiedDiff: context mismatch at line ${srcIdx + 1}. ` +
            `expected=${JSON.stringify(op.text)} got=${JSON.stringify(srcLines[srcIdx])}`
          );
        }
        outLines.push(srcLines[srcIdx]);
        srcIdx++;
      } else if (op.kind === "del") {
        if (srcLines[srcIdx] !== op.text) {
          throw new Error(
            `applyUnifiedDiff: delete mismatch at line ${srcIdx + 1}. ` +
            `expected=${JSON.stringify(op.text)} got=${JSON.stringify(srcLines[srcIdx])}`
          );
        }
        srcIdx++;
      } else if (op.kind === "add") {
        outLines.push(op.text);
      }
    }
  }
  // Copy any trailing lines.
  while (srcIdx < srcLines.length) {
    outLines.push(srcLines[srcIdx]);
    srcIdx++;
  }
  return outLines.join("\n");
}

// ─── Tool definitions ────────────────────────────────────────

/**
 * `edit_apply_diff` — Apply a unified diff to a single file.
 *
 * Performs an atomic write and optionally keeps a `.bak` next to the
 * target. Designed to be safe enough for autonomous agents:
 *   • context lines are verified before any write happens
 *   • the original file is left untouched on any parse / match error
 *   • a backup is made before swapping in the new content
 */
export const editApplyDiffTool: Tool = {
  name: "edit_apply_diff",
  description:
    "Apply a unified diff to a single file atomically with .bak backup. " +
    "Use this for precise, reviewable edits (preferred over file_write for in-place changes).",
  parameters: [
    { name: "path", type: "string", description: "File path to edit", required: true },
    { name: "diff", type: "string", description: "Unified diff text (single file)", required: true },
    { name: "backup", type: "boolean", description: "Keep a .bak backup (default true)", required: false },
  ],
  async execute(params) {
    const filePath = String(params.path);
    const diff = String(params.diff);
    const backup = params.backup === undefined ? true : Boolean(params.backup);

    // B4: Create snapshot before edit
    try {
      const snapshotManager = getSnapshotManager();
      await snapshotManager.createSnapshot(filePath, "edit");
    } catch {
      // Snapshot failure shouldn't block edit
    }

    const source = await readFile(filePath, "utf-8");
    let patched: string;
    try {
      patched = applyUnifiedDiff(source, diff);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `[ERROR] ${msg}`;
    }

    const { backupPath } = await atomicWrite(filePath, patched, { backup });
    return (
      `Applied diff to ${filePath} ` +
      `(${source.length} → ${patched.length} chars)` +
      (backupPath ? ` — backup: ${backupPath}` : "")
    );
  },
};

/**
 * `edit_atomic_write` — Replace a file's content atomically with an
 * optional `.bak` backup. Exposed primarily so skill / hook authors can
 * request the safe-write path explicitly.
 */
export const editAtomicWriteTool: Tool = {
  name: "edit_atomic_write",
  description:
    "Atomically replace a file's content. Writes to a temp file then renames; keeps a .bak by default.",
  parameters: [
    { name: "path", type: "string", description: "File path", required: true },
    { name: "content", type: "string", description: "New content", required: true },
    { name: "backup", type: "boolean", description: "Keep a .bak backup (default true)", required: false },
  ],
  async execute(params) {
    const filePath = String(params.path);
    const content = String(params.content);
    const backup = params.backup === undefined ? true : Boolean(params.backup);

    // B4: Create snapshot before write
    try {
      const snapshotManager = getSnapshotManager();
      await snapshotManager.createSnapshot(filePath, "write");
    } catch {
      // Snapshot failure shouldn't block write
    }

    const { backupPath } = await atomicWrite(filePath, content, { backup });
    return `Wrote ${filePath} (${content.length} chars)` + (backupPath ? ` — backup: ${backupPath}` : "");
  },
};

// Re-export for tests.
export const __test__ = { atomicWrite, parseUnifiedDiff, applyUnifiedDiff };

// Silence unused-import warnings.
void os;
