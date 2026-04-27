import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  gitStatusTool,
  gitCommitTool,
  gitBranchTool,
  gitLogTool,
  gitCheckoutTool,
  gitWorktreeTool,
  __test__,
} from "../src/tools/builtin/git.js";

const execAsync = promisify(exec);
const { guardRef, shellQuote } = __test__;

async function initRepo(dir: string): Promise<void> {
  await execAsync("git init -q -b main", { cwd: dir });
  await execAsync("git config user.email test@example.com", { cwd: dir });
  await execAsync("git config user.name Test", { cwd: dir });
  await execAsync("git commit --allow-empty -m init -q", { cwd: dir });
}

describe("git helpers", () => {
  it("guardRef rejects dangerous strings", () => {
    expect(guardRef("")).toMatch(/empty/);
    expect(guardRef("feat/foo")).toBeNull();
    expect(guardRef("a; rm -rf /")).toMatch(/unsafe/);
    expect(guardRef("$(whoami)")).toMatch(/unsafe/);
  });

  it("shellQuote single-quotes safely", () => {
    expect(shellQuote("abc")).toBe("'abc'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("git tools (live repo)", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-git-"));
    await initRepo(dir);
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("status reports clean tree then dirty after write", async () => {
    const out1 = String(await gitStatusTool.execute({ cwd: dir }));
    expect(out1).toMatch(/## main/);
    await writeFile(path.join(dir, "a.txt"), "hi");
    const out2 = String(await gitStatusTool.execute({ cwd: dir }));
    expect(out2).toContain("a.txt");
  });

  it("commit stages and creates new commit", async () => {
    await writeFile(path.join(dir, "b.txt"), "content");
    const res = String(await gitCommitTool.execute({ cwd: dir, message: "feat: add b" }));
    expect(res).not.toMatch(/\[ERROR\]/);
    const log = String(await gitLogTool.execute({ cwd: dir, limit: 5 }));
    expect(log).toContain("feat: add b");
  });

  it("rejects empty commit message", async () => {
    const res = String(await gitCommitTool.execute({ cwd: dir, message: "" }));
    expect(res).toMatch(/\[ERROR\]/);
  });

  it("branch create/list/delete", async () => {
    await gitBranchTool.execute({ cwd: dir, action: "create", name: "feat/x" });
    const list = String(await gitBranchTool.execute({ cwd: dir, action: "list" }));
    expect(list).toContain("feat/x");
    const del = String(await gitBranchTool.execute({ cwd: dir, action: "delete", name: "feat/x" }));
    expect(del).not.toMatch(/\[ERROR\]/);
  });

  it("branch rejects unsafe names", async () => {
    const out = String(await gitBranchTool.execute({
      cwd: dir, action: "create", name: "$(id)",
    }));
    expect(out).toMatch(/\[ERROR\].*unsafe ref/);
  });

  it("checkout switches branches", async () => {
    await gitBranchTool.execute({ cwd: dir, action: "create", name: "dev" });
    const out = String(await gitCheckoutTool.execute({ cwd: dir, ref: "dev" }));
    expect(out).not.toMatch(/\[ERROR\]/);
    const status = String(await gitStatusTool.execute({ cwd: dir }));
    expect(status).toMatch(/## dev/);
  });

  it("worktree list returns main worktree path", async () => {
    const out = String(await gitWorktreeTool.execute({ cwd: dir, action: "list" }));
    expect(out).toContain(dir);
  });

  it("worktree add requires path", async () => {
    const out = String(await gitWorktreeTool.execute({ cwd: dir, action: "add" }));
    expect(out).toMatch(/\[ERROR\] path is required/);
  });
});
