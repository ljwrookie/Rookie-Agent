import { readFile, writeFile, rename, unlink, stat } from "fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { randomBytes } from "node:crypto";
import { Tool } from "../types.js";
import { saveSnapshot } from "../snapshot.js";

// ─── B9.2: Constants ───────────────────────────────────────────

const MAX_EDIT_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GiB

// Curly quotes to straight quotes mapping
const QUOTE_MAP: Record<string, string> = {
  "\u201c": '"', // Left double quotation mark
  "\u201d": '"', // Right double quotation mark
  "\u2018": "'", // Left single quotation mark
  "\u2019": "'", // Right single quotation mark
};

// ─── B9.2: File modification tracking ──────────────────────────

// Track mtime of files when read, to detect external modifications
const fileMtimeMap = new Map<string, number>();

export function recordFileMtime(filePath: string, mtime: number): void {
  fileMtimeMap.set(filePath, mtime);
}

export function getRecordedMtime(filePath: string): number | undefined {
  return fileMtimeMap.get(filePath);
}

export function clearRecordedMtime(filePath: string): void {
  fileMtimeMap.delete(filePath);
}

// ─── B9.2: Quote normalization ─────────────────────────────────

/**
 * Normalize curly quotes to straight quotes for better matching
 */
export function normalizeQuotes(str: string): string {
  return str.replace(/[\u201c\u201d\u2018\u2019]/g, char => QUOTE_MAP[char] || char);
}

/**
 * Find actual string in content with quote normalization fallback
 * Returns the position if found, -1 otherwise
 */
export function findActualString(content: string, search: string): { found: boolean; position: number; normalized: boolean } {
  // First try exact match
  let position = content.indexOf(search);
  if (position !== -1) {
    return { found: true, position, normalized: false };
  }

  // Try with normalized quotes
  const normalizedSearch = normalizeQuotes(search);
  const normalizedContent = normalizeQuotes(content);
  position = normalizedContent.indexOf(normalizedSearch);

  if (position !== -1) {
    return { found: true, position, normalized: true };
  }

  return { found: false, position: -1, normalized: false };
}

/**
 * Find all occurrences of a string with line context
 * Returns array of { lineNumber, context } for disambiguation
 */
export function findAllOccurrences(content: string, search: string): Array<{ lineNumber: number; context: string }> {
  const lines = content.split("\n");
  const results: Array<{ lineNumber: number; context: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(search)) {
      const startLine = Math.max(0, i - 3);
      const endLine = Math.min(lines.length, i + 4);
      const contextLines = lines.slice(startLine, endLine);
      const context = contextLines.map((l, idx) => `${startLine + idx + 1}: ${l}`).join("\n");
      results.push({ lineNumber: i + 1, context });
    }
  }

  return results;
}

// ─── B9.2: File size check ─────────────────────────────────────

export async function checkFileSize(filePath: string, maxSize = MAX_EDIT_FILE_SIZE): Promise<void> {
  const stats = await stat(filePath);
  if (stats.size > maxSize) {
    throw new Error(
      `File too large to edit: ${filePath} (${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GiB exceeds limit of ${(maxSize / 1024 / 1024 / 1024)} GiB)`
    );
  }
}

// ─── B9.2: Mtime validation ────────────────────────────────────

export async function validateMtime(filePath: string, expectedMtime?: number): Promise<void> {
  if (expectedMtime === undefined) return;

  const stats = await stat(filePath);
  if (stats.mtimeMs !== expectedMtime) {
    throw new Error(
      `File was modified externally: ${filePath}\n` +
      `Expected mtime: ${expectedMtime}, actual: ${stats.mtimeMs}\n` +
      `Please review the file and retry.`
    );
  }
}

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
    "Use this for precise, reviewable edits (preferred over file_write for in-place changes). " +
    "Supports quote normalization (curly → straight quotes) for better matching.",
  parameters: [
    { name: "path", type: "string", description: "File path to edit", required: true },
    { name: "diff", type: "string", description: "Unified diff text (single file)", required: true },
    { name: "backup", type: "boolean", description: "Keep a .bak backup (default true)", required: false },
    { name: "checkMtime", type: "boolean", description: "Validate file wasn't modified externally (default true)", required: false },
  ],
  async execute(params) {
    const filePath = String(params.path);
    const diff = String(params.diff);
    const backup = params.backup === undefined ? true : Boolean(params.backup);
    const checkMtime = params.checkMtime === undefined ? true : Boolean(params.checkMtime);

    // B9.2: Check file size
    try {
      await checkFileSize(filePath);
    } catch (e) {
      return `[ERROR] ${e instanceof Error ? e.message : String(e)}`;
    }

    // B4: Create snapshot before edit
    try {
      await saveSnapshot(process.cwd(), filePath);
    } catch {
      // Snapshot failure shouldn't block edit
    }

    // Read file and record mtime
    const source = await readFile(filePath, "utf-8");
    const recordedMtime = getRecordedMtime(filePath);

    // B9.2: Validate mtime to prevent overwriting external changes
    if (checkMtime && recordedMtime !== undefined) {
      try {
        await validateMtime(filePath, recordedMtime);
      } catch (e) {
        return `[ERROR] ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    let patched: string;
    try {
      patched = applyUnifiedDiff(source, diff);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // B9.2: Check for multiple matches if context mismatch
      if (msg.includes("context mismatch") || msg.includes("delete mismatch")) {
        const match = msg.match(/expected=.*got=/);
        if (match) {
          // Extract the expected line from the error
          const expectedMatch = msg.match(/expected="([^"]*)"/);
          if (expectedMatch) {
            const searchStr = expectedMatch[1];
            const occurrences = findAllOccurrences(source, searchStr);
            if (occurrences.length > 1) {
              return `[ERROR] ${msg}\n\n` +
                `Found ${occurrences.length} occurrences of the search string. ` +
                `Please use a more specific context or specify line numbers.\n\n` +
                `Matches:\n${occurrences.map(o => `Line ${o.lineNumber}:\n${o.context}`).join("\n---\n")}`;
            }
          }
        }
      }

      return `[ERROR] ${msg}`;
    }

    // B9.2: Update recorded mtime after successful edit
    const { backupPath } = await atomicWrite(filePath, patched, { backup });
    const newStats = await stat(filePath);
    recordFileMtime(filePath, newStats.mtimeMs);

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
    "Atomically replace a file's content. Writes to a temp file then renames; keeps a .bak by default. " +
    "Supports create/update mode and mtime validation.",
  parameters: [
    { name: "path", type: "string", description: "File path", required: true },
    { name: "content", type: "string", description: "New content", required: true },
    { name: "backup", type: "boolean", description: "Keep a .bak backup (default true)", required: false },
    { name: "mode", type: "string", description: "'create' (fail if exists) or 'update' (default)", required: false },
    { name: "checkMtime", type: "boolean", description: "Validate file wasn't modified externally (default true for update)", required: false },
  ],
  async execute(params) {
    const filePath = String(params.path);
    const content = String(params.content);
    const backup = params.backup === undefined ? true : Boolean(params.backup);
    const mode = params.mode ? String(params.mode) : "update";
    const checkMtime = params.checkMtime === undefined ? (mode === "update") : Boolean(params.checkMtime);

    // B9.2: Check file size for existing files
    try {
      await stat(filePath);
      await checkFileSize(filePath);
    } catch (e) {
      // File doesn't exist, that's fine for create mode
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        return `[ERROR] ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // B9.2: Create mode - fail if file exists
    if (mode === "create") {
      try {
        await stat(filePath);
        return `[ERROR] File already exists: ${filePath}. Use mode='update' to overwrite.`;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
        // File doesn't exist, proceed
      }
    }

    // B9.2: Update mode - validate mtime
    if (mode === "update" && checkMtime) {
      const recordedMtime = getRecordedMtime(filePath);
      if (recordedMtime !== undefined) {
        try {
          await validateMtime(filePath, recordedMtime);
        } catch (e) {
          return `[ERROR] ${e instanceof Error ? e.message : String(e)}`;
        }
      }
    }

    // B4: Create snapshot before write
    try {
      await saveSnapshot(process.cwd(), filePath);
    } catch {
      // Snapshot failure shouldn't block write
    }

    // B9.2: Ensure content ends with newline
    const normalizedContent = content.endsWith("\n") ? content : content + "\n";

    const { backupPath } = await atomicWrite(filePath, normalizedContent, { backup });

    // B9.2: Update recorded mtime
    try {
      const newStats = await stat(filePath);
      recordFileMtime(filePath, newStats.mtimeMs);
    } catch {
      // Ignore stat errors
    }

    return `Wrote ${filePath} (${normalizedContent.length} chars)` + (backupPath ? ` — backup: ${backupPath}` : "");
  },
};

// Re-export for tests.
export const __test__ = {
  atomicWrite,
  parseUnifiedDiff,
  applyUnifiedDiff,
  normalizeQuotes,
  findActualString,
  findAllOccurrences,
  checkFileSize,
  validateMtime,
  recordFileMtime,
  getRecordedMtime,
  clearRecordedMtime,
};

// Silence unused-import warnings.
void os;
