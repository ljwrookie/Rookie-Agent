// ─── File Snapshot Manager ───────────────────────────────────────
// B4: File history snapshots for undo/rollback

import { promises as fs, constants as fsConstants } from "fs";
import { createHash } from "crypto";
import { dirname, join, relative, resolve } from "path";

// B4: Snapshot metadata
export interface FileSnapshot {
  id: string;              // hash of content
  timestamp: number;       // creation time
  path: string;            // original file path
  content: string;         // file content at snapshot time
  mtime: number;           // file mtime at snapshot time
  size: number;            // file size
  reason: "edit" | "write" | "delete";  // why snapshot was created
}

// B4: Snapshot manager options
export interface SnapshotManagerOptions {
  projectRoot: string;
  maxSnapshots?: number;   // max snapshots to keep per file (default 100)
}

// B4: Snapshot manager
export class SnapshotManager {
  private projectRoot: string;
  private maxSnapshots: number;
  private historyDir: string;

  constructor(options: SnapshotManagerOptions) {
    this.projectRoot = resolve(options.projectRoot);
    this.maxSnapshots = options.maxSnapshots ?? 100;
    this.historyDir = join(this.projectRoot, ".rookie", "history");
  }

  // B4: Initialize history directory
  async init(): Promise<void> {
    await fs.mkdir(this.historyDir, { recursive: true });
  }

  // B4: Create snapshot before file modification
  async createSnapshot(
    filePath: string,
    reason: "edit" | "write" | "delete" = "edit"
  ): Promise<FileSnapshot | null> {
    const resolvedPath = resolve(this.projectRoot, filePath);

    // Check if file exists
    try {
      await fs.access(resolvedPath, fsConstants.F_OK);
    } catch {
      // File doesn't exist, nothing to snapshot
      return null;
    }

    // Read file content and stats
    const [content, stats] = await Promise.all([
      fs.readFile(resolvedPath, "utf-8"),
      fs.stat(resolvedPath),
    ]);

    // Generate snapshot ID from content hash
    const id = createHash("sha256").update(content).digest("hex").slice(0, 16);

    const snapshot: FileSnapshot = {
      id,
      timestamp: Date.now(),
      path: relative(this.projectRoot, resolvedPath),
      content,
      mtime: stats.mtime.getTime(),
      size: stats.size,
      reason,
    };

    // Save snapshot to disk
    await this.saveSnapshot(snapshot);

    // Cleanup old snapshots for this file
    await this.cleanupOldSnapshots(snapshot.path);

    return snapshot;
  }

  // B4: Save snapshot to disk
  private async saveSnapshot(snapshot: FileSnapshot): Promise<void> {
    const fileName = `${snapshot.id}_${snapshot.timestamp}.snapshot`;
    const filePath = join(this.historyDir, fileName);

    await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf-8");
  }

  // B4: Get all snapshots for a file
  async getSnapshotsForFile(filePath: string): Promise<FileSnapshot[]> {
    const normalizedPath = relative(this.projectRoot, resolve(this.projectRoot, filePath));

    const files = await fs.readdir(this.historyDir).catch(() => [] as string[]);
    const snapshots: FileSnapshot[] = [];

    for (const file of files) {
      if (!file.endsWith(".snapshot")) continue;

      try {
        const content = await fs.readFile(join(this.historyDir, file), "utf-8");
        const snapshot: FileSnapshot = JSON.parse(content);

        if (snapshot.path === normalizedPath) {
          snapshots.push(snapshot);
        }
      } catch {
        // Skip invalid snapshots
      }
    }

    // Sort by timestamp descending (newest first)
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  // B4: Restore file to snapshot
  async restoreSnapshot(snapshotId: string): Promise<boolean> {
    const files = await fs.readdir(this.historyDir).catch(() => [] as string[]);

    for (const file of files) {
      if (!file.startsWith(snapshotId) || !file.endsWith(".snapshot")) continue;

      try {
        const content = await fs.readFile(join(this.historyDir, file), "utf-8");
        const snapshot: FileSnapshot = JSON.parse(content);

        // Check current mtime to prevent overwriting external changes
        const resolvedPath = resolve(this.projectRoot, snapshot.path);
        let currentMtime: number | null = null;

        try {
          const stats = await fs.stat(resolvedPath);
          currentMtime = stats.mtime.getTime();
        } catch {
          // File doesn't exist, that's okay for restore
        }

        // If file exists and has been modified since snapshot, warn but still restore
        if (currentMtime && currentMtime !== snapshot.mtime) {
          console.warn(`Warning: File ${snapshot.path} has been modified since snapshot was taken`);
        }

        // Ensure directory exists
        await fs.mkdir(dirname(resolvedPath), { recursive: true });

        // Restore content
        await fs.writeFile(resolvedPath, snapshot.content, "utf-8");

        return true;
      } catch (e) {
        console.error("Failed to restore snapshot:", e);
        return false;
      }
    }

    return false;
  }

  // B4: Check if file has been modified externally
  async isFileModifiedExternally(filePath: string, expectedMtime: number): Promise<boolean> {
    const resolvedPath = resolve(this.projectRoot, filePath);

    try {
      const stats = await fs.stat(resolvedPath);
      return stats.mtime.getTime() !== expectedMtime;
    } catch {
      // File doesn't exist
      return true;
    }
  }

  // B4: Cleanup old snapshots for a file
  private async cleanupOldSnapshots(filePath: string): Promise<void> {
    const snapshots = await this.getSnapshotsForFile(filePath);

    if (snapshots.length <= this.maxSnapshots) return;

    // Delete oldest snapshots
    const toDelete = snapshots.slice(this.maxSnapshots);

    for (const snapshot of toDelete) {
      const fileName = `${snapshot.id}_${snapshot.timestamp}.snapshot`;
      const filePath = join(this.historyDir, fileName);

      try {
        await fs.unlink(filePath);
      } catch {
        // Ignore deletion errors
      }
    }
  }

  // B4: List all snapshots
  async listAllSnapshots(): Promise<FileSnapshot[]> {
    const files = await fs.readdir(this.historyDir).catch(() => [] as string[]);
    const snapshots: FileSnapshot[] = [];

    for (const file of files) {
      if (!file.endsWith(".snapshot")) continue;

      try {
        const content = await fs.readFile(join(this.historyDir, file), "utf-8");
        snapshots.push(JSON.parse(content));
      } catch {
        // Skip invalid snapshots
      }
    }

    // Sort by timestamp descending
    return snapshots.sort((a, b) => b.timestamp - a.timestamp);
  }

  // B4: Delete snapshot
  async deleteSnapshot(snapshotId: string): Promise<boolean> {
    const files = await fs.readdir(this.historyDir).catch(() => [] as string[]);

    for (const file of files) {
      if (file.startsWith(snapshotId) && file.endsWith(".snapshot")) {
        try {
          await fs.unlink(join(this.historyDir, file));
          return true;
        } catch {
          return false;
        }
      }
    }

    return false;
  }
}

// B4: Global snapshot manager instance
let globalSnapshotManager: SnapshotManager | null = null;

export function getSnapshotManager(options?: SnapshotManagerOptions): SnapshotManager {
  if (!globalSnapshotManager && options) {
    globalSnapshotManager = new SnapshotManager(options);
  }
  if (!globalSnapshotManager) {
    throw new Error("SnapshotManager not initialized");
  }
  return globalSnapshotManager;
}

export function initSnapshotManager(options: SnapshotManagerOptions): SnapshotManager {
  globalSnapshotManager = new SnapshotManager(options);
  return globalSnapshotManager;
}
