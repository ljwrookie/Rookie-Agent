import { readFile } from "node:fs/promises";
import { Tool } from "../types.js";
import { atomicWrite } from "./edit.js";

// ─── .ipynb minimal shape ───────────────────────────────────

export type NotebookCellType = "code" | "markdown" | "raw";

export interface NotebookCell {
  cell_type: NotebookCellType;
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
  [key: string]: unknown;
}

export interface Notebook {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
  [key: string]: unknown;
}

// ─── Helpers ────────────────────────────────────────────────

function cellSourceToString(src: NotebookCell["source"]): string {
  return Array.isArray(src) ? src.join("") : String(src);
}

function stringToCellSource(src: string): string[] {
  // Jupyter's canonical form is an array of lines each ending with \n,
  // except possibly the last one.
  if (src === "") return [];
  const lines = src.split(/\n/);
  const out = lines.map((l, i) => (i < lines.length - 1 ? l + "\n" : l));
  if (out[out.length - 1] === "") out.pop();
  return out;
}

export async function loadNotebook(filePath: string): Promise<Notebook> {
  const raw = await readFile(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid JSON in ${filePath}: ${(e as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Notebook).cells)) {
    throw new Error(`file is not a valid notebook: ${filePath}`);
  }
  return parsed as Notebook;
}

export async function saveNotebook(
  filePath: string,
  nb: Notebook,
  opts: { backup?: boolean } = {},
): Promise<{ backupPath?: string }> {
  const serialised = JSON.stringify(nb, null, 1) + "\n";
  return atomicWrite(filePath, serialised, { backup: opts.backup ?? true });
}

// ─── Tools ──────────────────────────────────────────────────

export const notebookReadTool: Tool = {
  name: "notebook_read",
  description:
    "Read a Jupyter notebook (.ipynb) and return a human-readable summary " +
    "with cell index, type, and source (outputs omitted).",
  parameters: [
    { name: "path", type: "string", description: "Notebook file path", required: true },
    { name: "cell", type: "number", description: "Return only this 0-based cell index", required: false },
  ],
  async execute(params) {
    const filePath = String(params.path);
    const nb = await loadNotebook(filePath);
    const total = nb.cells.length;

    if (typeof params.cell === "number") {
      const idx = params.cell;
      if (idx < 0 || idx >= total) {
        return `[ERROR] cell index out of range (0..${total - 1})`;
      }
      const cell = nb.cells[idx];
      return `Cell ${idx} [${cell.cell_type}]\n---\n${cellSourceToString(cell.source)}`;
    }

    const parts: string[] = [`Notebook ${filePath} — ${total} cell(s)`];
    for (let i = 0; i < total; i++) {
      const cell = nb.cells[i];
      const src = cellSourceToString(cell.source);
      parts.push(`\n[${i}] ${cell.cell_type}\n${src}`);
    }
    return parts.join("\n");
  },
};

export type NotebookEditMode = "replace" | "insert" | "delete";

export const notebookEditTool: Tool = {
  name: "notebook_edit",
  description:
    "Edit a Jupyter notebook cell. Modes: 'replace' (default, update source), " +
    "'insert' (create a new cell at `cell` index), 'delete' (remove cell). " +
    "Writes atomically with .bak backup.",
  parameters: [
    { name: "path", type: "string", description: "Notebook file path", required: true },
    { name: "mode", type: "string", description: "replace | insert | delete", required: false },
    { name: "cell", type: "number", description: "0-based cell index", required: true },
    { name: "source", type: "string", description: "New source (for replace/insert)", required: false },
    { name: "cellType", type: "string", description: "code | markdown | raw (insert only)", required: false },
    { name: "backup", type: "boolean", description: "Keep .bak backup (default true)", required: false },
  ],
  async execute(params) {
    const filePath = String(params.path);
    const mode = ((params.mode as string) || "replace").toLowerCase() as NotebookEditMode;
    const idx = Number(params.cell);
    if (!Number.isInteger(idx) || idx < 0) return "[ERROR] invalid cell index";
    const backup = params.backup === undefined ? true : Boolean(params.backup);

    let nb: Notebook;
    try {
      nb = await loadNotebook(filePath);
    } catch (e) {
      return `[ERROR] ${(e as Error).message}`;
    }

    if (mode === "replace") {
      if (idx >= nb.cells.length) return "[ERROR] cell index out of range";
      if (params.source === undefined) return "[ERROR] source is required for replace";
      nb.cells[idx] = {
        ...nb.cells[idx],
        source: stringToCellSource(String(params.source)),
        // Clear cached outputs when we change code cells.
        ...(nb.cells[idx].cell_type === "code" ? { outputs: [], execution_count: null } : {}),
      };
    } else if (mode === "insert") {
      if (idx > nb.cells.length) return "[ERROR] cell index out of range";
      if (params.source === undefined) return "[ERROR] source is required for insert";
      const cellType = ((params.cellType as string) || "code") as NotebookCellType;
      if (!["code", "markdown", "raw"].includes(cellType)) {
        return `[ERROR] unknown cellType "${cellType}"`;
      }
      const cell: NotebookCell = {
        cell_type: cellType,
        source: stringToCellSource(String(params.source)),
        metadata: {},
      };
      if (cellType === "code") {
        cell.outputs = [];
        cell.execution_count = null;
      }
      nb.cells.splice(idx, 0, cell);
    } else if (mode === "delete") {
      if (idx >= nb.cells.length) return "[ERROR] cell index out of range";
      nb.cells.splice(idx, 1);
    } else {
      return `[ERROR] unknown mode "${mode}"`;
    }

    const { backupPath } = await saveNotebook(filePath, nb, { backup });
    return (
      `Notebook ${mode}: cell ${idx} (${nb.cells.length} cells total)` +
      (backupPath ? ` — backup: ${backupPath}` : "")
    );
  },
};

export const __test__ = { cellSourceToString, stringToCellSource };
