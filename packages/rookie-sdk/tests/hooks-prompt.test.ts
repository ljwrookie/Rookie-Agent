import { describe, it, expect } from "vitest";
import { HookRegistry, type HookPromptRunner } from "../src/hooks/registry.js";

function makeRunner(output: string): { runner: HookPromptRunner; calls: Array<{ prompt: string }> } {
  const calls: Array<{ prompt: string }> = [];
  const runner: HookPromptRunner = async (prompt) => {
    calls.push({ prompt });
    return output;
  };
  return { runner, calls };
}

describe("HookRegistry LLM prompt", () => {
  it("runs prompt via injected runner and returns output", async () => {
    const { runner, calls } = makeRunner("looks fine");
    const reg = new HookRegistry({ promptRunner: runner });

    reg.register({ event: "UserPromptSubmit", prompt: "Is this safe? {{input}}" });
    const results = await reg.fire("UserPromptSubmit", {
      sessionId: "s1",
      projectRoot: "/tmp",
    });

    expect(calls).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].output).toBe("looks fine");
    expect(results[0].rejected).toBeUndefined();
  });

  it("marks as rejected when canReject and output says 'reject'", async () => {
    const { runner } = makeRunner("I reject this because it seems harmful.");
    const reg = new HookRegistry({ promptRunner: runner });

    reg.register({
      event: "PreToolUse",
      prompt: "Evaluate the tool call",
      canReject: true,
    });
    const results = await reg.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "file_write",
      projectRoot: "/tmp",
    });

    expect(results[0].success).toBe(false);
    expect(results[0].rejected).toBe(true);
  });

  it("ignores 'reject' output when canReject is not set", async () => {
    const { runner } = makeRunner("I would deny this");
    const reg = new HookRegistry({ promptRunner: runner });

    reg.register({ event: "UserPromptSubmit", prompt: "x" });
    const results = await reg.fire("UserPromptSubmit", { sessionId: "s1", projectRoot: "/tmp" });

    expect(results[0].success).toBe(true);
    expect(results[0].rejected).toBeUndefined();
  });

  it("surfaces an error when no promptRunner is configured", async () => {
    const reg = new HookRegistry();
    reg.register({ event: "UserPromptSubmit", prompt: "x", canReject: true });
    const results = await reg.fire("UserPromptSubmit", { sessionId: "s1", projectRoot: "/tmp" });
    expect(results[0].success).toBe(false);
    expect(results[0].output).toMatch(/promptRunner/);
    expect(results[0].rejected).toBe(true);
  });

  it("late-binds promptRunner via setPromptRunner", async () => {
    const reg = new HookRegistry();
    const { runner } = makeRunner("hello");
    reg.setPromptRunner(runner);

    reg.register({ event: "SessionStart", prompt: "greet" });
    const results = await reg.fire("SessionStart", { sessionId: "s1", projectRoot: "/tmp" });
    expect(results[0].success).toBe(true);
    expect(results[0].output).toBe("hello");
  });
});
