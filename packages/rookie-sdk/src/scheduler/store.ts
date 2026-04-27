// Scheduler persistence layer

import { readFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { SchedulerStore, ScheduledTask } from "./types.js";
import { atomicWrite } from "../tools/builtin/edit.js";

const DEFAULT_STORE_PATH = ".rookie/schedulers.json";

export async function loadSchedulerStore(
  projectRoot: string,
  relativePath: string = DEFAULT_STORE_PATH
): Promise<SchedulerStore> {
  const filePath = path.join(projectRoot, relativePath);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.tasks)) {
      return { version: 1, tasks: parsed.tasks };
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return { version: 1, tasks: [] };
}

export async function saveSchedulerStore(
  projectRoot: string,
  store: SchedulerStore,
  relativePath: string = DEFAULT_STORE_PATH
): Promise<void> {
  const filePath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWrite(filePath, JSON.stringify(store, null, 2) + "\n", { backup: false });
}

export function generateTaskId(): string {
  return `sch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function validateTask(task: Partial<ScheduledTask>): string | null {
  if (!task.name || task.name.trim().length === 0) {
    return "Task name is required";
  }
  if (!task.command || task.command.trim().length === 0) {
    return "Command is required";
  }
  if (!task.interval) {
    return "Interval is required";
  }
  return null;
}
