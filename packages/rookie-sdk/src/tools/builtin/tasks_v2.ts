// ─── V2 Task System Tools ────────────────────────────────────────
// B10.8: File-system based task management with dependency tracking

import { readFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { Tool } from "../types.js";
import { atomicWrite } from "./edit.js";

// ─── Types ───────────────────────────────────────────────────────

export type TaskStatusV2 = "pending" | "in_progress" | "completed" | "blocked" | "cancelled";
export type TaskPriority = "P0" | "P1" | "P2" | "P3";

export interface TaskV2 {
  id: string;
  title: string;
  description?: string;
  status: TaskStatusV2;
  priority: TaskPriority;
  assignee?: string;
  blocks: string[];      // IDs this task blocks
  blockedBy: string[];   // IDs blocking this task
  result?: string;       // Completion summary
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface TaskStoreV2 {
  version: 2;
  sessionId: string;
  tasks: TaskV2[];
}

// ─── Storage ─────────────────────────────────────────────────────

const TASKS_DIR = ".rookie/tasks";

function getTasksDir(projectRoot: string): string {
  return path.join(projectRoot, TASKS_DIR);
}

function getTaskFilePath(projectRoot: string, sessionId: string): string {
  return path.join(getTasksDir(projectRoot), `${sessionId}.json`);
}

async function ensureTasksDir(projectRoot: string): Promise<void> {
  await mkdir(getTasksDir(projectRoot), { recursive: true });
}

async function readTaskStore(projectRoot: string, sessionId: string): Promise<TaskStoreV2> {
  const filePath = getTaskFilePath(projectRoot, sessionId);
  try {
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.version === 2 && Array.isArray(parsed.tasks)) {
      return parsed as TaskStoreV2;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return { version: 2, sessionId, tasks: [] };
}

async function writeTaskStore(projectRoot: string, store: TaskStoreV2): Promise<void> {
  await ensureTasksDir(projectRoot);
  const filePath = getTaskFilePath(projectRoot, store.sessionId);
  await atomicWrite(filePath, JSON.stringify(store, null, 2) + "\n", { backup: false });
}

function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Task Operations ─────────────────────────────────────────────

function validateStatusTransition(from: TaskStatusV2, to: TaskStatusV2): boolean {
  // Invalid transitions:
  // - completed -> pending (must reopen as new task)
  // - cancelled -> anything (terminal state)
  if (from === "cancelled") return false;
  if (from === "completed" && to === "pending") return false;
  return true;
}

function updateBlockedTasks(tasks: TaskV2[]): TaskV2[] {
  // Recalculate blocked status based on dependencies
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  return tasks.map(task => {
    if (task.status === "blocked" || task.status === "pending") {
      const hasBlockingIncomplete = task.blockedBy.some(blockerId => {
        const blocker = taskMap.get(blockerId);
        return blocker && blocker.status !== "completed" && blocker.status !== "cancelled";
      });

      if (hasBlockingIncomplete && task.status !== "blocked") {
        return { ...task, status: "blocked" as TaskStatusV2, updatedAt: Date.now() };
      }
      if (!hasBlockingIncomplete && task.status === "blocked") {
        return { ...task, status: "pending" as TaskStatusV2, updatedAt: Date.now() };
      }
    }
    return task;
  });
}

// ─── Tools ───────────────────────────────────────────────────────

/**
 * TaskCreateTool - Create a new V2 task
 */
export const taskCreateTool: Tool = {
  name: "task_create",
  description:
    "Create a new task in the V2 task system. " +
    "Supports dependency tracking via blocks/blockedBy fields. " +
    "Tasks are persisted to .rookie/tasks/{sessionId}.json.",
  parameters: [
    { name: "title", type: "string", description: "Task title", required: true },
    { name: "description", type: "string", description: "Task description", required: false },
    { name: "priority", type: "string", description: "Priority: P0/P1/P2/P3 (default P1)", required: false },
    { name: "blocks", type: "array", description: "Task IDs this task blocks", required: false },
    { name: "blockedBy", type: "array", description: "Task IDs blocking this task", required: false },
    { name: "assignee", type: "string", description: "Agent name to assign", required: false },
    { name: "sessionId", type: "string", description: "Session ID (default: 'default')", required: false },
    { name: "cwd", type: "string", description: "Project root", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : process.cwd();
    const sessionId = params.sessionId ? String(params.sessionId) : "default";

    const store = await readTaskStore(cwd, sessionId);

    const task: TaskV2 = {
      id: generateTaskId(),
      title: String(params.title),
      description: params.description ? String(params.description) : undefined,
      status: "pending",
      priority: (params.priority as TaskPriority) || "P1",
      assignee: params.assignee ? String(params.assignee) : undefined,
      blocks: Array.isArray(params.blocks) ? params.blocks.map(String) : [],
      blockedBy: Array.isArray(params.blockedBy) ? params.blockedBy.map(String) : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Check if blockedBy tasks exist and are incomplete
    const blockingIncomplete = task.blockedBy.filter(blockerId => {
      const blocker = store.tasks.find(t => t.id === blockerId);
      return blocker && blocker.status !== "completed" && blocker.status !== "cancelled";
    });

    if (blockingIncomplete.length > 0) {
      task.status = "blocked";
    }

    store.tasks.push(task);
    await writeTaskStore(cwd, store);

    return `Created task ${task.id}: "${task.title}" [${task.priority}]${task.status === "blocked" ? " (blocked)" : ""}`;
  },
};

/**
 * TaskUpdateTool - Update a V2 task
 */
export const taskUpdateTool: Tool = {
  name: "task_update",
  description:
    "Update an existing V2 task. Supports status changes, assignment, and result recording. " +
    "Automatically updates dependent tasks' blocked status.",
  parameters: [
    { name: "taskId", type: "string", description: "Task ID to update", required: true },
    { name: "status", type: "string", description: "New status: pending/in_progress/completed/blocked/cancelled", required: false },
    { name: "assignee", type: "string", description: "Assignee name (use empty string to unassign)", required: false },
    { name: "result", type: "string", description: "Completion result summary", required: false },
    { name: "title", type: "string", description: "New title", required: false },
    { name: "description", type: "string", description: "New description", required: false },
    { name: "priority", type: "string", description: "New priority", required: false },
    { name: "sessionId", type: "string", description: "Session ID", required: false },
    { name: "cwd", type: "string", description: "Project root", required: false },
  ],
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : process.cwd();
    const sessionId = params.sessionId ? String(params.sessionId) : "default";
    const taskId = String(params.taskId);

    const store = await readTaskStore(cwd, sessionId);
    const taskIndex = store.tasks.findIndex(t => t.id === taskId);

    if (taskIndex === -1) {
      return `[ERROR] Task not found: ${taskId}`;
    }

    const task = store.tasks[taskIndex];
    const updates: Partial<TaskV2> = { updatedAt: Date.now() };

    // Status update with validation
    if (params.status) {
      const newStatus = String(params.status) as TaskStatusV2;
      if (!validateStatusTransition(task.status, newStatus)) {
        return `[ERROR] Invalid status transition: ${task.status} -> ${newStatus}`;
      }
      updates.status = newStatus;

      if (newStatus === "completed") {
        updates.completedAt = Date.now();
      }
    }

    // Assignee update
    if (params.assignee !== undefined) {
      updates.assignee = params.assignee === "" ? undefined : String(params.assignee);
    }

    // Result update
    if (params.result !== undefined) {
      updates.result = String(params.result);
    }

    // Title/description/priority updates
    if (params.title) updates.title = String(params.title);
    if (params.description !== undefined) updates.description = String(params.description);
    if (params.priority) updates.priority = String(params.priority) as TaskPriority;

    store.tasks[taskIndex] = { ...task, ...updates };

    // Update blocked status for all tasks
    store.tasks = updateBlockedTasks(store.tasks);

    await writeTaskStore(cwd, store);

    const updatedTask = store.tasks[taskIndex];
    return `Updated task ${taskId} [${updatedTask.status}]${updatedTask.assignee ? ` assigned to ${updatedTask.assignee}` : ""}`;
  },
};

/**
 * TaskListTool - List V2 tasks
 */
export const taskListTool: Tool = {
  name: "task_list",
  description:
    "List V2 tasks with optional filtering. " +
    "Returns tasks sorted by priority (P0 first) then creation time.",
  parameters: [
    { name: "status", type: "string", description: "Filter by status", required: false },
    { name: "assignee", type: "string", description: "Filter by assignee", required: false },
    { name: "priority", type: "string", description: "Filter by priority", required: false },
    { name: "sessionId", type: "string", description: "Session ID", required: false },
    { name: "cwd", type: "string", description: "Project root", required: false },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : process.cwd();
    const sessionId = params.sessionId ? String(params.sessionId) : "default";

    const store = await readTaskStore(cwd, sessionId);

    let tasks = store.tasks;

    // Apply filters
    if (params.status) {
      tasks = tasks.filter(t => t.status === params.status);
    }
    if (params.assignee) {
      tasks = tasks.filter(t => t.assignee === params.assignee);
    }
    if (params.priority) {
      tasks = tasks.filter(t => t.priority === params.priority);
    }

    // Sort by priority (P0 > P1 > P2 > P3) then by creation time
    const priorityOrder: Record<TaskPriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
    tasks.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.createdAt - b.createdAt;
    });

    if (tasks.length === 0) {
      return "No tasks found.";
    }

    const lines: string[] = [`Found ${tasks.length} task(s):\n`];

    for (const task of tasks) {
      const statusEmoji = {
        pending: "○",
        in_progress: "◐",
        completed: "✓",
        blocked: "⊘",
        cancelled: "✗",
      }[task.status];

      lines.push(`${statusEmoji} [${task.priority}] ${task.title}`);
      lines.push(`   ID: ${task.id} | Status: ${task.status}`);

      if (task.assignee) lines.push(`   Assignee: ${task.assignee}`);
      if (task.blockedBy.length > 0) lines.push(`   Blocked by: ${task.blockedBy.join(", ")}`);
      if (task.blocks.length > 0) lines.push(`   Blocks: ${task.blocks.join(", ")}`);
      if (task.result) lines.push(`   Result: ${task.result.slice(0, 100)}${task.result.length > 100 ? "..." : ""}`);

      lines.push("");
    }

    return lines.join("\n");
  },
};

/**
 * TaskGetTool - Get a single V2 task
 */
export const taskGetTool: Tool = {
  name: "task_get",
  description:
    "Get detailed information about a single V2 task, including dependency chain and history.",
  parameters: [
    { name: "taskId", type: "string", description: "Task ID", required: true },
    { name: "sessionId", type: "string", description: "Session ID", required: false },
    { name: "cwd", type: "string", description: "Project root", required: false },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    const cwd = params.cwd ? String(params.cwd) : process.cwd();
    const sessionId = params.sessionId ? String(params.sessionId) : "default";
    const taskId = String(params.taskId);

    const store = await readTaskStore(cwd, sessionId);
    const task = store.tasks.find(t => t.id === taskId);

    if (!task) {
      return `[ERROR] Task not found: ${taskId}`;
    }

    const statusEmoji = {
      pending: "○",
      in_progress: "◐",
      completed: "✓",
      blocked: "⊘",
      cancelled: "✗",
    }[task.status];

    const lines: string[] = [
      `${statusEmoji} ${task.title}`,
      `ID: ${task.id}`,
      `Priority: ${task.priority}`,
      `Status: ${task.status}`,
      `Created: ${new Date(task.createdAt).toLocaleString()}`,
      `Updated: ${new Date(task.updatedAt).toLocaleString()}`,
    ];

    if (task.completedAt) {
      lines.push(`Completed: ${new Date(task.completedAt).toLocaleString()}`);
    }

    if (task.assignee) lines.push(`Assignee: ${task.assignee}`);
    if (task.description) lines.push(`\nDescription:\n${task.description}`);

    // Dependency chain
    if (task.blockedBy.length > 0) {
      lines.push(`\nBlocked by (${task.blockedBy.length}):`);
      for (const blockerId of task.blockedBy) {
        const blocker = store.tasks.find(t => t.id === blockerId);
        const bStatus = blocker ? `[${blocker.status}] ${blocker.title}` : "(unknown)";
        lines.push(`  • ${blockerId}: ${bStatus}`);
      }
    }

    if (task.blocks.length > 0) {
      lines.push(`\nBlocks (${task.blocks.length}):`);
      for (const blockedId of task.blocks) {
        const blocked = store.tasks.find(t => t.id === blockedId);
        const bStatus = blocked ? `[${blocked.status}] ${blocked.title}` : "(unknown)";
        lines.push(`  • ${blockedId}: ${bStatus}`);
      }
    }

    if (task.result) {
      lines.push(`\nResult:\n${task.result}`);
    }

    return lines.join("\n");
  },
};
