// B4: File history snapshot system
// Tracks file edits and allows undoing changes

import { readFile, writeFile, mkdir, readdir, stat, unlink } from "fs/promises";
import { join, dirname } from "path";
import { createHash } from "crypto";

const MAX_SNAPSHOTS = 100;
const SNAPSHOT_DIR = ".rookie/history";

export interface FileSnapshot {
  id: string;
  filePath: string;
  content: string;
  timestamp: number;
  mtime: number;
  size: number;
}

export interface SnapshotMetadata {
  id: string;
  filePath: string;
  timestamp: number;
  mtime: number;
  size: number;
  hash: string;
}

/**
 * Generate a unique snapshot ID based on file path and timestamp.
 */
function generateSnapshotId(filePath: string, timestamp: number): string {
  const hash = createHash("sha256")
    .update(`${filePath}:${timestamp}`)
    .digest("hex")
    .slice(0, 16);
  return hash;
}

/**
 * Get the snapshot directory path for a project.
 */
export function getSnapshotDir(projectRoot: string): string {
  return join(projectRoot, SNAPSHOT_DIR);
}

/**
 * Ensure the snapshot directory exists.
 */
async function ensureSnapshotDir(projectRoot: string): Promise<void> {
  const dir = getSnapshotDir(projectRoot);
  await mkdir(dir, { recursive: true });
}

/**
 * Save a snapshot of a file before editing.
 * Returns the snapshot ID.
 */
export async function saveSnapshot(
  projectRoot: string,
  filePath: string
): Promise<string | null> {
  try {
    await ensureSnapshotDir(projectRoot);

    const content = await readFile(filePath, "utf-8");
    const stats = await stat(filePath);
    const timestamp = Date.now();
    const id = generateSnapshotId(filePath, timestamp);

    const snapshot: FileSnapshot = {
      id,
      filePath,
      content,
      timestamp,
      mtime: stats.mtimeMs,
      size: stats.size,
    };

    const snapshotPath = join(getSnapshotDir(projectRoot), `${id}.json`);
    await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");

    // Clean up old snapshots if exceeding MAX_SNAPSHOTS
    await cleanupOldSnapshots(projectRoot);

    return id;
  } catch (error) {
    // File might not exist (new file), that's okay
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Restore a file from a snapshot.
 */
export async function restoreSnapshot(
  projectRoot: string,
  snapshotId: string
): Promise<boolean> {
  try {
    const snapshotPath = join(getSnapshotDir(projectRoot), `${snapshotId}.json`);
    const snapshotData = await readFile(snapshotPath, "utf-8");
    const snapshot: FileSnapshot = JSON.parse(snapshotData);

    // Check if file has been modified since snapshot
    try {
      const currentStats = await stat(snapshot.filePath);
      if (currentStats.mtimeMs !== snapshot.mtime) {
        console.warn(
          `Warning: File ${snapshot.filePath} has been modified since snapshot was taken.`
        );
      }
    } catch {
      // File might not exist, that's okay
    }

    // Ensure parent directory exists
    await mkdir(dirname(snapshot.filePath), { recursive: true });

    // Restore the file
    await writeFile(snapshot.filePath, snapshot.content, "utf-8");
    return true;
  } catch (error) {
    console.error("Failed to restore snapshot:", error);
    return false;
  }
}

/**
 * List all available snapshots.
 */
export async function listSnapshots(
  projectRoot: string,
  filePath?: string
): Promise<SnapshotMetadata[]> {
  try {
    const dir = getSnapshotDir(projectRoot);
    const files = await readdir(dir);

    const snapshots: SnapshotMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      try {
        const snapshotPath = join(dir, file);
        const data = await readFile(snapshotPath, "utf-8");
        const snapshot: FileSnapshot = JSON.parse(data);

        if (!filePath || snapshot.filePath === filePath) {
          snapshots.push({
            id: snapshot.id,
            filePath: snapshot.filePath,
            timestamp: snapshot.timestamp,
            mtime: snapshot.mtime,
            size: snapshot.size,
            hash: createHash("sha256").update(snapshot.content).digest("hex").slice(0, 16),
          });
        }
      } catch {
        // Skip invalid snapshots
      }
    }

    // Sort by timestamp (newest first)
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  } catch {
    return [];
  }
}

/**
 * Get a specific snapshot by ID.
 */
export async function getSnapshot(
  projectRoot: string,
  snapshotId: string
): Promise<FileSnapshot | null> {
  try {
    const snapshotPath = join(getSnapshotDir(projectRoot), `${snapshotId}.json`);
    const data = await readFile(snapshotPath, "utf-8");
    return JSON.parse(data) as FileSnapshot;
  } catch {
    return null;
  }
}

/**
 * Clean up old snapshots, keeping only the most recent MAX_SNAPSHOTS.
 */
async function cleanupOldSnapshots(projectRoot: string): Promise<void> {
  try {
    const snapshots = await listSnapshots(projectRoot);

    if (snapshots.length > MAX_SNAPSHOTS) {
      const toDelete = snapshots.slice(MAX_SNAPSHOTS);
      for (const snapshot of toDelete) {
        try {
          const snapshotPath = join(getSnapshotDir(projectRoot), `${snapshot.id}.json`);
          await unlink(snapshotPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}

/**
 * Check if a file has been modified externally (mtime changed).
 */
export async function checkFileModified(
  filePath: string,
  expectedMtime: number
): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.mtimeMs !== expectedMtime;
  } catch {
    // File doesn't exist, consider it modified
    return true;
  }
}
