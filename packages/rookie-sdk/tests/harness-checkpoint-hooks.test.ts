import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionHarness } from "../src/harness/session.js";
import { HookRegistry } from "../src/hooks/registry.js";

const FEATURE = {
  id: "f1",
  description: "Add feature X",
  status: "passed" as const,
  attempts: 0,
};

describe("SessionHarness checkpoint hooks", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rookie-ckpt-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fires PreCheckpoint then PostCheckpoint around a checkpoint", async () => {
    const hooks = new HookRegistry();
    const events: Array<{ event: string; featureId?: unknown }> = [];

    // Stub prompt runner so we can assert on fires.
    hooks.setPromptRunner(async (_p, ctx, cfg) => {
      events.push({ event: cfg.event, featureId: ctx.toolInput?.feature_id });
      return "ok";
    });

    hooks.register({ event: "PreCheckpoint", prompt: "check" });
    hooks.register({ event: "PostCheckpoint", prompt: "record" });

    // Seed the harness with a task + feature list so checkpoint's feature
    // status update can find the record.
    const harness = new SessionHarness({ projectRoot: dir, hooks, sessionId: "sess-1" });
    await harness.initialize("task", [{ ...FEATURE, status: "pending" }]);

    await harness.checkpoint({
      feature: FEATURE,
      commitMessage: "feat: X",
      progressUpdate: "done",
    });

    expect(events.map((e) => e.event)).toEqual(["PreCheckpoint", "PostCheckpoint"]);
    expect(events[0].featureId).toBe("f1");
  });

  it("PreCheckpoint rejection aborts the checkpoint", async () => {
    const hooks = new HookRegistry();
    hooks.setPromptRunner(async () => "reject this — not approved");
    hooks.register({ event: "PreCheckpoint", prompt: "gate", canReject: true });

    const harness = new SessionHarness({ projectRoot: dir, hooks, sessionId: "sess-2" });
    await harness.initialize("task", [{ ...FEATURE, status: "pending" }]);

    await expect(
      harness.checkpoint({
        feature: FEATURE,
        commitMessage: "feat: X",
        progressUpdate: "done",
      }),
    ).rejects.toThrow(/PreCheckpoint hook rejected/);
  });
});
