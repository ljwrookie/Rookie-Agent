import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { globFilesTool, grepFilesTool, __test__ } from "../src/tools/builtin/glob.js";

const { globToRegExp } = __test__;

describe("globToRegExp", () => {
  it("matches `**/*.ts`", () => {
    const re = globToRegExp("**/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/deep/b.ts")).toBe(true);
    expect(re.test("src/a.js")).toBe(false);
  });

  it("matches `src/*.ts` (no nested)", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/deep/b.ts")).toBe(false);
  });

  it("supports {a,b} alternation", () => {
    const re = globToRegExp("{src,tests}/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("tests/a.ts")).toBe(true);
    expect(re.test("lib/a.ts")).toBe(false);
  });
});

describe("globFilesTool", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-glob-"));
    await mkdir(path.join(dir, "src", "nested"), { recursive: true });
    await mkdir(path.join(dir, "node_modules", "lodash"), { recursive: true });
    await writeFile(path.join(dir, "src", "a.ts"), "// a");
    await writeFile(path.join(dir, "src", "b.js"), "// b");
    await writeFile(path.join(dir, "src", "nested", "c.ts"), "// c");
    await writeFile(path.join(dir, "node_modules", "lodash", "index.js"), "");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("finds .ts files recursively", async () => {
    const out = String(await globFilesTool.execute({ pattern: "**/*.ts", cwd: dir }));
    const lines = out.split("\n").sort();
    expect(lines).toContain("src/a.ts");
    expect(lines).toContain(path.join("src", "nested", "c.ts"));
    expect(lines.some((l) => l.includes("b.js"))).toBe(false);
  });

  it("respects default ignore (node_modules)", async () => {
    const out = String(await globFilesTool.execute({ pattern: "**/*.js", cwd: dir }));
    expect(out).toContain("src/b.js");
    expect(out).not.toContain("node_modules");
  });
});

describe("grepFilesTool", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-grep-"));
    await writeFile(path.join(dir, "a.ts"), "hello world\nfoo bar\nHELLO\n");
    await writeFile(path.join(dir, "b.ts"), "nothing here\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns path:line:content matches", async () => {
    const out = String(await grepFilesTool.execute({ pattern: "hello", cwd: dir }));
    expect(out).toContain("a.ts:1:hello world");
    expect(out).toContain("a.ts:3:HELLO"); // case-insensitive default
    expect(out).not.toContain("b.ts");
  });

  it("reports invalid regex", async () => {
    const out = String(await grepFilesTool.execute({ pattern: "[unclosed", cwd: dir }));
    expect(out).toMatch(/\[ERROR\] invalid regex/);
  });

  it("filters by glob", async () => {
    const out = String(await grepFilesTool.execute({
      pattern: "nothing",
      cwd: dir,
      glob: "b.ts",
    }));
    expect(out).toContain("b.ts:1:nothing here");
  });
});
