import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runHookList, runHookAdd, runHookTest, runHookRemove, settingsPath,
} from "../src/commands/hook.js";
import {
  runPermList, runPermSet, runPermMove,
} from "../src/commands/permission.js";

function tmp(): string { return mkdtempSync(join(tmpdir(), "rookie-settings-")); }
function readLocal(root: string): Record<string, unknown> {
  const f = settingsPath(root, "local");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf-8")) : {};
}

describe("rookie hook", () => {
  it("add / list / remove round-trip", async () => {
    const root = tmp();
    const addCode = await runHookAdd({
      projectRoot: root,
      event: "PreToolUse",
      command: "echo hi",
      matcher: "file_*",
      canReject: true,
    });
    expect(addCode).toBe(0);

    const file = settingsPath(root, "local");
    const s = JSON.parse(readFileSync(file, "utf-8"));
    expect(s.hooks.PreToolUse).toHaveLength(1);
    expect(s.hooks.PreToolUse[0].matcher).toBe("file_*");

    const listLogs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { listLogs.push(a.join(" ")); };
    try { await runHookList({ projectRoot: root }); } finally { console.log = orig; }
    expect(listLogs.some((l) => l.includes("PreToolUse"))).toBe(true);
    expect(listLogs.some((l) => l.includes("echo hi"))).toBe(true);

    const removeCode = await runHookRemove({ projectRoot: root, event: "PreToolUse", index: 0 });
    expect(removeCode).toBe(0);
    const after = readLocal(root);
    expect(after.hooks).toBeDefined();
    expect((after.hooks as Record<string, unknown[]>).PreToolUse).toBeUndefined();
  });

  it("add rejects unknown events", async () => {
    const root = tmp();
    const code = await runHookAdd({ projectRoot: root, event: "NopeEvent", command: "x" });
    expect(code).toBe(1);
  });

  it("test fires matching shell hook", async () => {
    const root = tmp();
    await runHookAdd({
      projectRoot: root,
      event: "PostToolUse",
      command: "echo tested",
      matcher: "file_read",
    });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const code = await runHookTest({ projectRoot: root, event: "PostToolUse", toolName: "file_read" });
      expect(code).toBe(0);
    } finally { console.log = orig; }
    expect(logs.some((l) => l.startsWith("✓ PostToolUse"))).toBe(true);
  });
});

describe("rookie permission", () => {
  it("allow / deny upsert to local settings and list prints them", async () => {
    const root = tmp();
    await runPermSet({ projectRoot: root, tool: "file_write", action: "allow" });
    await runPermSet({ projectRoot: root, tool: "file_write", action: "deny" }); // overwrite

    const s = readLocal(root) as { permissions: Array<{ tool: string; action: string }> };
    expect(s.permissions).toHaveLength(1);
    expect(s.permissions[0]).toMatchObject({ tool: "file_write", action: "deny" });

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try { await runPermList({ projectRoot: root }); } finally { console.log = orig; }
    expect(logs.some((l) => l.includes("deny") && l.includes("file_write"))).toBe(true);
  });

  it("move shifts a rule between project and local scope", async () => {
    const root = tmp();
    // Seed project settings with a rule
    const projectFile = settingsPath(root, "project");
    mkdirSync(join(root, ".rookie"), { recursive: true });
    writeFileSync(projectFile, JSON.stringify({ permissions: [{ tool: "git_push", action: "ask" }] }));

    const code = await runPermMove({ projectRoot: root, from: "project", to: "local", index: 0 });
    expect(code).toBe(0);

    const projectAfter = JSON.parse(readFileSync(projectFile, "utf-8"));
    expect(projectAfter.permissions).toEqual([]);

    const localAfter = readLocal(root) as { permissions: Array<{ tool: string }> };
    expect(localAfter.permissions[0].tool).toBe("git_push");
  });

  it("move rejects same source and destination", async () => {
    const code = await runPermMove({ projectRoot: tmp(), from: "local", to: "local", index: 0 });
    expect(code).toBe(1);
  });
});
