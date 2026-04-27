import { readFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { Tool } from "../types.js";
import { atomicWrite } from "./edit.js";

// ─── Shape ───────────────────────────────────────────────────

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  activeForm?: string;   // present-continuous used while in_progress
  createdAt: number;
  updatedAt: number;
}

export interface TodoStore {
  version: 1;
  items: TodoItem[];
}

const DEFAULT_FILE = ".rookie/todos.json";

// ─── I/O helpers (exported for TUI) ──────────────────────────

export function todosPath(projectRoot: string, relative = DEFAULT_FILE): string {
  return path.join(projectRoot, relative);
}

export async function readTodos(file: string): Promise<TodoStore> {
  try {
    const raw = await readFile(file, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.items)) {
      return { version: 1, items: parsed.items };
    }
  } catch { /* fall through */ }
  return { version: 1, items: [] };
}

export async function writeTodos(file: string, store: TodoStore): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await atomicWrite(file, JSON.stringify(store, null, 2) + "\n", { backup: false });
}

// ─── Operation types ─────────────────────────────────────────

export type TodoOp =
  | { op: "add"; content: string; id?: string; activeForm?: string; status?: TodoStatus }
  | { op: "update"; id: string; status?: TodoStatus; content?: string; activeForm?: string }
  | { op: "remove"; id: string }
  | { op: "replace"; items: Array<Omit<TodoItem, "createdAt" | "updatedAt">> };

function genId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function applyOps(store: TodoStore, ops: TodoOp[], now = () => Date.now()): TodoStore {
  const out: TodoStore = { version: 1, items: store.items.map((i) => ({ ...i })) };
  for (const op of ops) {
    const ts = now();
    if (op.op === "add") {
      out.items.push({
        id: op.id ?? genId(),
        content: op.content,
        status: op.status ?? "pending",
        activeForm: op.activeForm,
        createdAt: ts,
        updatedAt: ts,
      });
    } else if (op.op === "update") {
      const idx = out.items.findIndex((i) => i.id === op.id);
      if (idx === -1) throw new Error(`todo_write: id not found: ${op.id}`);
      const cur = out.items[idx];
      out.items[idx] = {
        ...cur,
        status: op.status ?? cur.status,
        content: op.content ?? cur.content,
        activeForm: op.activeForm ?? cur.activeForm,
        updatedAt: ts,
      };
    } else if (op.op === "remove") {
      const idx = out.items.findIndex((i) => i.id === op.id);
      if (idx === -1) throw new Error(`todo_write: id not found: ${op.id}`);
      out.items.splice(idx, 1);
    } else if (op.op === "replace") {
      out.items = op.items.map((i) => ({ ...i, createdAt: ts, updatedAt: ts }));
    }
  }
  return out;
}

// ─── Tool definition ─────────────────────────────────────────

export interface TodoWriteDeps {
  /** Override project root in tests; defaults to param.cwd or process.cwd(). */
  now?: () => number;
}

export function createTodoWriteTool(deps: TodoWriteDeps = {}): Tool {
  const now = deps.now ?? (() => Date.now());
  return {
    name: "todo_write",
    description:
      "Create / update / remove items in the shared TODO list at .rookie/todos.json. " +
      "Supports add, update, remove, and replace ops. Drives the TUI Todo panel.",
    parameters: [
      {
        name: "ops",
        type: "array",
        description:
          "Array of ops. Each item is one of: " +
          "{op:'add', content, [activeForm], [status], [id]}, " +
          "{op:'update', id, [status], [content], [activeForm]}, " +
          "{op:'remove', id}, " +
          "{op:'replace', items:[{id, content, status, [activeForm]}]}.",
        required: true,
      },
      { name: "cwd", type: "string", description: "Project root (default cwd)", required: false },
    ],
    async execute(params) {
      const cwd = params.cwd ? String(params.cwd) : process.cwd();
      const ops = params.ops as TodoOp[] | undefined;
      if (!Array.isArray(ops)) return "[ERROR] ops must be an array";

      const file = todosPath(cwd);
      const store = await readTodos(file);
      let next: TodoStore;
      try {
        next = applyOps(store, ops, now);
      } catch (e) {
        return `[ERROR] ${(e as Error).message}`;
      }
      await writeTodos(file, next);
      const counts = countByStatus(next);
      return (
        `Updated ${ops.length} op(s). ` +
        `Now ${next.items.length} todo(s) ` +
        `[pending=${counts.pending} in_progress=${counts.in_progress} completed=${counts.completed} cancelled=${counts.cancelled}]`
      );
    },
  };
}

function countByStatus(store: TodoStore): Record<TodoStatus, number> {
  const c: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const i of store.items) c[i.status]++;
  return c;
}

export const todoWriteTool: Tool = createTodoWriteTool();
