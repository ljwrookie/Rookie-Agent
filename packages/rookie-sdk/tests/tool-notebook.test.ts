import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  notebookReadTool,
  notebookEditTool,
  loadNotebook,
  __test__,
} from "../src/tools/builtin/notebook.js";

const { cellSourceToString, stringToCellSource } = __test__;

function sampleNotebook(): unknown {
  return {
    cells: [
      { cell_type: "markdown", source: ["# Title\n"], metadata: {} },
      { cell_type: "code", source: ["print('hi')\n"], metadata: {}, outputs: [], execution_count: 1 },
    ],
    metadata: {},
    nbformat: 4,
    nbformat_minor: 5,
  };
}

describe("notebook helpers", () => {
  it("cellSourceToString handles string and string[]", () => {
    expect(cellSourceToString("abc")).toBe("abc");
    expect(cellSourceToString(["a\n", "b\n"])).toBe("a\nb\n");
  });

  it("stringToCellSource keeps trailing newlines on all but last", () => {
    expect(stringToCellSource("a\nb")).toEqual(["a\n", "b"]);
    expect(stringToCellSource("")).toEqual([]);
  });
});

describe("notebook tools", () => {
  let dir: string;
  let nbPath: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-nb-"));
    nbPath = path.join(dir, "s.ipynb");
    await writeFile(nbPath, JSON.stringify(sampleNotebook()), "utf-8");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a notebook summary", async () => {
    const out = String(await notebookReadTool.execute({ path: nbPath }));
    expect(out).toContain("2 cell(s)");
    expect(out).toContain("markdown");
    expect(out).toContain("print('hi')");
  });

  it("reads a single cell", async () => {
    const out = String(await notebookReadTool.execute({ path: nbPath, cell: 0 }));
    expect(out).toContain("[markdown]");
    expect(out).toContain("# Title");
  });

  it("replaces a cell and clears code outputs", async () => {
    await notebookEditTool.execute({
      path: nbPath, mode: "replace", cell: 1, source: "x = 42\n",
    });
    const nb = await loadNotebook(nbPath);
    expect(cellSourceToString(nb.cells[1].source)).toBe("x = 42\n");
    expect(nb.cells[1].outputs).toEqual([]);
    expect(nb.cells[1].execution_count).toBeNull();
    // .bak created
    const bak = await readFile(`${nbPath}.bak`, "utf-8");
    expect(bak).toContain("print('hi')");
  });

  it("inserts a new cell at the given index", async () => {
    await notebookEditTool.execute({
      path: nbPath, mode: "insert", cell: 1, source: "# inserted",
      cellType: "markdown",
    });
    const nb = await loadNotebook(nbPath);
    expect(nb.cells.length).toBe(3);
    expect(nb.cells[1].cell_type).toBe("markdown");
  });

  it("deletes a cell", async () => {
    await notebookEditTool.execute({ path: nbPath, mode: "delete", cell: 0 });
    const nb = await loadNotebook(nbPath);
    expect(nb.cells.length).toBe(1);
    expect(nb.cells[0].cell_type).toBe("code");
  });

  it("rejects out-of-range indices", async () => {
    const out = String(await notebookEditTool.execute({
      path: nbPath, mode: "replace", cell: 99, source: "x",
    }));
    expect(out).toMatch(/out of range/);
  });

  it("rejects invalid JSON notebook", async () => {
    await writeFile(nbPath, "not json");
    const out = String(await notebookReadTool.execute({ path: nbPath }).catch((e: Error) => `[ERROR] ${e.message}`));
    expect(out).toMatch(/invalid JSON/);
  });
});
