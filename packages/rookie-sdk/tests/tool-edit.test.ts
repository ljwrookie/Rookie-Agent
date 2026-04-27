import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  editApplyDiffTool,
  editAtomicWriteTool,
  __test__,
} from "../src/tools/builtin/edit.js";

const { atomicWrite, parseUnifiedDiff, applyUnifiedDiff } = __test__;

describe("atomicWrite", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-edit-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("creates a new file without backup when absent", async () => {
    const p = path.join(dir, "a.txt");
    const res = await atomicWrite(p, "hello");
    expect(await readFile(p, "utf-8")).toBe("hello");
    expect(res.backupPath).toBeUndefined();
  });

  it("backs up existing file when backup=true", async () => {
    const p = path.join(dir, "b.txt");
    await writeFile(p, "old", "utf-8");
    const res = await atomicWrite(p, "new", { backup: true });
    expect(await readFile(p, "utf-8")).toBe("new");
    expect(res.backupPath).toBe(`${p}.bak`);
    expect(await readFile(`${p}.bak`, "utf-8")).toBe("old");
  });

  it("overwrites existing .bak on repeated writes", async () => {
    const p = path.join(dir, "c.txt");
    await writeFile(p, "v1", "utf-8");
    await atomicWrite(p, "v2", { backup: true });
    await atomicWrite(p, "v3", { backup: true });
    expect(await readFile(p, "utf-8")).toBe("v3");
    expect(await readFile(`${p}.bak`, "utf-8")).toBe("v2");
  });

  it("does not leak temp files on success", async () => {
    const p = path.join(dir, "d.txt");
    await atomicWrite(p, "x");
    const entries = await (await import("node:fs/promises")).readdir(dir);
    expect(entries.filter((f) => f.includes(".tmp"))).toEqual([]);
  });
});

describe("parseUnifiedDiff", () => {
  it("parses a simple hunk", () => {
    const diff = [
      "--- a/x",
      "+++ b/x",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
    ].join("\n");
    const hunks = parseUnifiedDiff(diff);
    expect(hunks.length).toBe(1);
    expect(hunks[0].oldStart).toBe(1);
    expect(hunks[0].ops.map((o) => o.kind)).toEqual(["ctx", "del", "add", "ctx"]);
  });

  it("defaults to 1 line when count is omitted", () => {
    const diff = ["@@ -5 +5 @@", "-old", "+new"].join("\n");
    const [h] = parseUnifiedDiff(diff);
    expect(h.oldLines).toBe(1);
    expect(h.newLines).toBe(1);
  });
});

describe("applyUnifiedDiff", () => {
  it("applies add/del/ctx correctly", () => {
    const src = "a\nb\nc\n";
    const diff = [
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
    ].join("\n");
    expect(applyUnifiedDiff(src, diff)).toBe("a\nB\nc\n");
  });

  it("throws on context mismatch", () => {
    const src = "a\nb\nc\n";
    const diff = ["@@ -1,3 +1,3 @@", " a", "-X", "+Y", " c"].join("\n");
    expect(() => applyUnifiedDiff(src, diff)).toThrow(/delete mismatch/);
  });

  it("supports multiple hunks", () => {
    const src = ["a", "b", "c", "d", "e"].join("\n");
    const diff = [
      "@@ -1,1 +1,1 @@",
      "-a",
      "+A",
      "@@ -5,1 +5,1 @@",
      "-e",
      "+E",
    ].join("\n");
    expect(applyUnifiedDiff(src, diff)).toBe(["A", "b", "c", "d", "E"].join("\n"));
  });
});

describe("editApplyDiffTool", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-edit-tool-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("applies a diff and creates .bak", async () => {
    const p = path.join(dir, "f.txt");
    await writeFile(p, "a\nb\nc\n", "utf-8");
    const out = await editApplyDiffTool.execute({
      path: p,
      diff: ["@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n"),
    });
    expect(await readFile(p, "utf-8")).toBe("a\nB\nc\n");
    expect(await stat(`${p}.bak`)).toBeTruthy();
    expect(String(out)).toContain("Applied diff");
  });

  it("returns [ERROR] without modifying file on mismatch", async () => {
    const p = path.join(dir, "g.txt");
    await writeFile(p, "orig\n", "utf-8");
    const out = await editApplyDiffTool.execute({
      path: p,
      diff: ["@@ -1,1 +1,1 @@", "-nope", "+new"].join("\n"),
      backup: false,
    });
    expect(String(out)).toMatch(/\[ERROR\]/);
    expect(await readFile(p, "utf-8")).toBe("orig\n");
  });
});

describe("editAtomicWriteTool", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-edit-aw-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes atomically with backup", async () => {
    const p = path.join(dir, "h.txt");
    await writeFile(p, "v1", "utf-8");
    const out = await editAtomicWriteTool.execute({ path: p, content: "v2" });
    expect(await readFile(p, "utf-8")).toBe("v2");
    expect(await readFile(`${p}.bak`, "utf-8")).toBe("v1");
    expect(String(out)).toContain("backup");
  });
});
