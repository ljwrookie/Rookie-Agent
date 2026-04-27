import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "../src/commands/init.js";
import { runResume } from "../src/commands/resume.js";
import { runProgress } from "../src/commands/progress.js";

function tmp(): string { return mkdtempSync(join(tmpdir(), "rookie-cli-")); }

describe("rookie init / resume / progress", () => {
  it("init with single --task seeds progress + features files", async () => {
    const root = tmp();
    const code = await runInit({ projectRoot: root, task: "write docs" });
    expect(code).toBe(0);
    expect(existsSync(join(root, ".rookie/progress.md"))).toBe(true);
    expect(existsSync(join(root, ".rookie/features.json"))).toBe(true);
    const features = JSON.parse(readFileSync(join(root, ".rookie/features.json"), "utf-8"));
    expect(features.task).toBe("write docs");
    expect(features.features).toHaveLength(1);
    expect(features.features[0].status).toBe("pending");
  });

  it("init with --features-file accepts multiple features", async () => {
    const root = tmp();
    const featuresFile = join(root, "feats.json");
    writeFileSync(
      featuresFile,
      JSON.stringify([
        { id: "a", description: "alpha", verifyCommand: "true" },
        { id: "b", description: "beta" },
      ]),
    );
    const code = await runInit({ projectRoot: root, task: "multi", featuresFile });
    expect(code).toBe(0);
    const features = JSON.parse(readFileSync(join(root, ".rookie/features.json"), "utf-8"));
    expect(features.features.map((f: { id: string }) => f.id)).toEqual(["a", "b"]);
    expect(features.features[0].verifyCommand).toBe("true");
  });

  it("init rejects empty --task", async () => {
    const code = await runInit({ projectRoot: tmp(), task: "" });
    expect(code).toBe(1);
  });

  it("resume reports the next pending feature after init", async () => {
    const root = tmp();
    await runInit({ projectRoot: root, task: "resume-me" });
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { logs.push(a.join(" ")); };
    try {
      const code = await runResume({ projectRoot: root });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
    }
    const joined = logs.join("\n");
    expect(joined).toContain("Phase:");
    expect(joined).toContain("Current feature:");
    expect(joined).toContain("resume-me");
  });

  it("resume returns 1 when no session exists", async () => {
    const code = await runResume({ projectRoot: tmp() });
    expect(code).toBe(1);
  });

  it("progress --format json emits progress + features", async () => {
    const root = tmp();
    await runInit({ projectRoot: root, task: "json-out" });
    const chunks: string[] = [];
    const orig = console.log;
    console.log = (...a: unknown[]) => { chunks.push(a.join(" ")); };
    try {
      const code = await runProgress({ projectRoot: root, format: "json" });
      expect(code).toBe(0);
    } finally {
      console.log = orig;
    }
    const payload = JSON.parse(chunks.join("\n"));
    expect(payload.progress).toContain("json-out");
    expect(payload.features.features[0].description).toBe("json-out");
  });
});
