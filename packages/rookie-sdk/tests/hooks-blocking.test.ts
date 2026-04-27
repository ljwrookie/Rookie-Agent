import { describe, it, expect } from "vitest";
import { HookRegistry, type HookPromptRunner } from "../src/hooks/registry.js";

describe("HookRegistry blocking=false", () => {
  it("returns immediately without waiting for prompt runner", async () => {
    let resolveLater: (value: string) => void = () => {};
    const slowRunner: HookPromptRunner = () =>
      new Promise<string>((resolve) => {
        resolveLater = resolve;
      });

    const reg = new HookRegistry({ promptRunner: slowRunner });
    reg.register({
      event: "SessionStart",
      prompt: "long analysis",
      blocking: false,
    });

    const start = Date.now();
    const results = await reg.fire("SessionStart", { sessionId: "s1", projectRoot: "/tmp" });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50); // did not block on the 未完成 runner
    expect(results[0].success).toBe(true);
    expect(results[0].output).toContain("non-blocking");

    // Clean up pending promise to avoid unhandled-rejection noise.
    resolveLater("late");
  });

  it("swallows errors in non-blocking hooks", async () => {
    const reg = new HookRegistry({
      promptRunner: async () => {
        throw new Error("boom");
      },
    });
    reg.register({ event: "SessionStart", prompt: "x", blocking: false });

    const results = await reg.fire("SessionStart", { sessionId: "s1", projectRoot: "/tmp" });
    expect(results[0].success).toBe(true);
    // No unhandled rejection should escape; wait a tick and assert process is fine.
    await new Promise((r) => setTimeout(r, 10));
  });
});
