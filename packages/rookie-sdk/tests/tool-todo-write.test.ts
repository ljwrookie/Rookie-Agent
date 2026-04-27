import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  createTodoWriteTool,
  readTodos,
  todosPath,
  applyOps,
} from "../src/tools/builtin/todo_write.js";

describe("applyOps", () => {
  const clock = () => {
    let t = 1_000;
    return () => ++t;
  };

  it("adds, updates, and removes items", () => {
    const now = clock();
    const s0 = { version: 1 as const, items: [] };
    const s1 = applyOps(s0, [{ op: "add", content: "one", id: "a" }], now);
    expect(s1.items[0]).toMatchObject({ id: "a", content: "one", status: "pending" });

    const s2 = applyOps(s1, [{ op: "update", id: "a", status: "in_progress" }], now);
    expect(s2.items[0].status).toBe("in_progress");
    expect(s2.items[0].updatedAt).toBeGreaterThan(s1.items[0].updatedAt);

    const s3 = applyOps(s2, [{ op: "remove", id: "a" }], now);
    expect(s3.items.length).toBe(0);
  });

  it("replace swaps all items", () => {
    const s0 = { version: 1 as const, items: [] };
    const s1 = applyOps(s0, [
      { op: "replace", items: [{ id: "x", content: "x", status: "pending" }] },
    ]);
    expect(s1.items.length).toBe(1);
    expect(s1.items[0].id).toBe("x");
  });

  it("throws on unknown id", () => {
    const s0 = { version: 1 as const, items: [] };
    expect(() => applyOps(s0, [{ op: "update", id: "none" }])).toThrow(/id not found/);
  });
});

describe("todoWriteTool", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-todo-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists ops to .rookie/todos.json", async () => {
    const tool = createTodoWriteTool();
    await tool.execute({
      cwd: dir,
      ops: [
        { op: "add", content: "write tests", id: "t1" },
        { op: "add", content: "ship it", id: "t2" },
        { op: "update", id: "t1", status: "completed" },
      ],
    });
    const file = todosPath(dir);
    const store = await readTodos(file);
    expect(store.items.map((i) => i.id)).toEqual(["t1", "t2"]);
    expect(store.items[0].status).toBe("completed");
  });

  it("returns an error without touching file on bad ops", async () => {
    const tool = createTodoWriteTool();
    const out = await tool.execute({ cwd: dir, ops: [{ op: "update", id: "nope" }] });
    expect(String(out)).toMatch(/\[ERROR\]/);
    const store = await readTodos(todosPath(dir));
    expect(store.items.length).toBe(0);
  });

  it("validates ops is an array", async () => {
    const tool = createTodoWriteTool();
    const out = await tool.execute({ cwd: dir, ops: "nope" as unknown as never });
    expect(String(out)).toMatch(/\[ERROR\] ops must be an array/);
  });
});
