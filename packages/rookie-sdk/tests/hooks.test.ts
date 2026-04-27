import { describe, it, expect, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { HookRegistry } from "../src/hooks/registry.js";

describe("HookRegistry", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rookie-hooks-"));
  });

  it("registers and fires a shell hook with env vars injected", async () => {
    const reg = new HookRegistry();
    const outFile = path.join(tmp, "out.txt");

    reg.register({
      event: "PostToolUse",
      matcher: "file_write",
      command: `printenv ROOKIE_TOOL_NAME > ${outFile}`,
    });

    const results = await reg.fire("PostToolUse", {
      sessionId: "s1",
      toolName: "file_write",
      toolInput: { path: "a.txt" },
      toolOutput: "ok",
      projectRoot: tmp,
    });

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    const content = (await fs.readFile(outFile, "utf-8")).trim();
    expect(content).toBe("file_write");
  });

  it("skips hooks when matcher does not match tool name", async () => {
    const reg = new HookRegistry();
    reg.register({
      event: "PreToolUse",
      matcher: "git_commit",
      command: "echo should-not-run",
    });

    const results = await reg.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "file_read",
      projectRoot: tmp,
    });

    expect(results).toHaveLength(0);
  });

  it("loads hooks from settings object", async () => {
    const reg = new HookRegistry();
    reg.loadFromSettings({
      hooks: {
        PostToolUse: [{ matcher: "*", command: "true" }],
      },
    });

    expect(reg.getHooksFor("PostToolUse")).toHaveLength(1);
  });

  it("marks failing shell hook as rejected when canReject=true", async () => {
    const reg = new HookRegistry();
    reg.register({
      event: "PreToolUse",
      matcher: "file_edit",
      command: "exit 1",
      canReject: true,
    });

    const results = await reg.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "file_edit",
      projectRoot: tmp,
    });
    expect(results[0].success).toBe(false);
    expect(results[0].rejected).toBe(true);
  });

  it("injects tool input params as uppercased env vars", async () => {
    const reg = new HookRegistry();
    const out = path.join(tmp, "path.txt");
    reg.register({
      event: "PostToolUse",
      matcher: "file_write",
      command: `printenv ROOKIE_TOOL_INPUT_PATH > ${out}`,
    });

    await reg.fire("PostToolUse", {
      sessionId: "s1",
      toolName: "file_write",
      toolInput: { path: "hello.txt" },
      projectRoot: tmp,
    });

    const content = (await fs.readFile(out, "utf-8")).trim();
    expect(content).toBe("hello.txt");
  });
});
