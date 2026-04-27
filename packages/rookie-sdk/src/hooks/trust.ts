// ─── Trust Management System ─────────────────────────────────────
// C6: Project trust mechanism for hook execution

import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";

// Trust storage path
const TRUST_STORE_PATH = path.join(homedir(), ".rookie", "trusted-projects.json");

// Trust levels
export type ProjectTrustLevel = "trusted" | "untrusted" | "pending";

export interface TrustEntry {
  projectRoot: string;
  level: ProjectTrustLevel;
  trustedAt?: number;
  trustedBy?: string;
}

export interface TrustStore {
  version: 1;
  projects: Record<string, TrustEntry>; // key: projectRoot
}

// In-memory cache
let trustCache: TrustStore | null = null;
let cacheLoaded = false;

/**
 * Load trust store from disk
 */
async function loadTrustStore(): Promise<TrustStore> {
  if (cacheLoaded && trustCache) {
    return trustCache;
  }

  try {
    const data = await readFile(TRUST_STORE_PATH, "utf-8");
    const parsed = JSON.parse(data) as TrustStore;
    if (parsed.version === 1 && parsed.projects) {
      trustCache = parsed;
      cacheLoaded = true;
      return parsed;
    }
  } catch {
    // File doesn't exist or is invalid
  }

  // Return empty store
  return { version: 1, projects: {} };
}

/**
 * Save trust store to disk
 */
async function saveTrustStore(store: TrustStore): Promise<void> {
  await mkdir(path.dirname(TRUST_STORE_PATH), { recursive: true });
  await writeFile(TRUST_STORE_PATH, JSON.stringify(store, null, 2) + "\n");
  trustCache = store;
  cacheLoaded = true;
}

/**
 * Get trust level for a project
 */
export async function getProjectTrust(projectRoot: string): Promise<ProjectTrustLevel> {
  const store = await loadTrustStore();
  const entry = store.projects[projectRoot];
  return entry?.level ?? "pending";
}

/**
 * Check if project is trusted
 */
export async function isProjectTrusted(projectRoot: string): Promise<boolean> {
  const level = await getProjectTrust(projectRoot);
  return level === "trusted";
}

/**
 * Trust a project
 */
export async function trustProject(projectRoot: string, trustedBy?: string): Promise<void> {
  const store = await loadTrustStore();
  store.projects[projectRoot] = {
    projectRoot,
    level: "trusted",
    trustedAt: Date.now(),
    trustedBy: trustedBy ?? "user",
  };
  await saveTrustStore(store);
}

/**
 * Untrust a project
 */
export async function untrustProject(projectRoot: string): Promise<void> {
  const store = await loadTrustStore();
  store.projects[projectRoot] = {
    projectRoot,
    level: "untrusted",
  };
  await saveTrustStore(store);
}

/**
 * Reset trust for a project (back to pending)
 */
export async function resetProjectTrust(projectRoot: string): Promise<void> {
  const store = await loadTrustStore();
  delete store.projects[projectRoot];
  await saveTrustStore(store);
}

/**
 * List all trusted projects
 */
export async function listTrustedProjects(): Promise<TrustEntry[]> {
  const store = await loadTrustStore();
  return Object.values(store.projects).filter(p => p.level === "trusted");
}

/**
 * Clear trust cache (for testing)
 */
export function clearTrustCache(): void {
  trustCache = null;
  cacheLoaded = false;
}
