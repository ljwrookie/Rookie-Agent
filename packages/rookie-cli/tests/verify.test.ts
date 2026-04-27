import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { runVerify } from "../src/commands/verify.js";
import { writeFileSync } from "node:fs";

function tmp(): string { return mkdtempSync(join(tmpdir(), "rookie-verify-")); }

describe("rookie verify", () => {
  it("returns 0 when every feature's verifyCommand passes", async () => {
    const root = tmp();
    const featsPath = join(root, "feats.json");
    writeFileSync(featsPath, JSON.stringify([
      { id: "ok-1", description: "A", verifyCommand: "true" },
      { id: "ok-2", description: "B", verifyCommand: "true" },
    ]));
    await runInit({ projectRoot: root, task: "verify-ok", featuresFile: featsPath });

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const code = await runVerify({ projectRoot: root });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
    }
    expect(logs.some((l) => l.startsWith("✓ ok-1"))).toBe(true);
    expect(logs.some((l) => l.startsWith("✓ ok-2"))).toBe(true);
  });

  it("returns 1 on first failure and stops when --bail", async () => {
    const root = tmp();
    const featsPath = join(root, "feats.json");
    writeFileSync(featsPath, JSON.stringify([
      { id: "fail-1", description: "X", verifyCommand: "exit 42" },
      { id: "never", description: "never-runs", verifyCommand: "true" },
    ]));
    await runInit({ projectRoot: root, task: "verify-bail", featuresFile: featsPath });

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const code = await runVerify({ projectRoot: root, bail: true });
      expect(code).toBe(1);
    } finally {
      console.log = orig;
    }
    expect(logs.some((l) => l.startsWith("✗ fail-1"))).toBe(true);
    expect(logs.some((l) => l.startsWith("✓ never"))).toBe(false);
  });

  it("can target a single feature via --feature", async () => {
    const root = tmp();
    const featsPath = join(root, "feats.json");
    writeFileSync(featsPath, JSON.stringify([
      { id: "a", description: "A", verifyCommand: "false" },
      { id: "b", description: "B", verifyCommand: "true" },
    ]));
    await runInit({ projectRoot: root, task: "verify-one", featuresFile: featsPath });

    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const code = await runVerify({ projectRoot: root, featureId: "b" });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
    }
    expect(logs.some((l) => l.includes("✓ b"))).toBe(true);
    expect(logs.some((l) => l.includes("a"))).toBe(false);
  });
});
