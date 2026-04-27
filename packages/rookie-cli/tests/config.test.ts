import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConfigShow } from "../src/commands/config.js";

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  return { lines, restore: () => { console.log = orig; } };
}

function makeTree(): { home: string; projectRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "rookie-config-"));
  const home = join(root, "home");
  const projectRoot = join(root, "repo");
  mkdirSync(join(home, ".rookie"), { recursive: true });
  mkdirSync(join(projectRoot, ".rookie"), { recursive: true });
  return { home, projectRoot };
}

describe("rookie config", () => {
  it("prints each layer's status and the winning source per key", async () => {
    const { home, projectRoot } = makeTree();
    writeFileSync(
      join(home, ".rookie", "settings.json"),
      JSON.stringify({ logging: { level: "info" } }),
    );
    writeFileSync(
      join(projectRoot, ".rookie", "settings.json"),
      JSON.stringify({ permissions: [{ tool: "file_edit", action: "ask" }] }),
    );
    writeFileSync(
      join(projectRoot, ".rookie", "settings.local.json"),
      JSON.stringify({ permissions: [{ tool: "shell_execute", action: "allow" }] }),
    );

    const { lines, restore } = captureStdout();
    try {
      const code = await runConfigShow({ home, projectRoot });
      expect(code).toBe(0);
    } finally {
      restore();
    }

    const output = lines.join("\n");
    expect(output).toContain("global");
    expect(output).toContain("project");
    expect(output).toContain("local");
    expect(output).toMatch(/permissions\s+←\s+local/);
    expect(output).toMatch(/logging\s+←\s+global/);
  });

  it("--format json emits merged + origins + per-layer raw", async () => {
    const { home, projectRoot } = makeTree();
    writeFileSync(
      join(projectRoot, ".rookie", "settings.json"),
      JSON.stringify({ env: { FOO: "bar" } }),
    );

    const { lines, restore } = captureStdout();
    try {
      const code = await runConfigShow({ home, projectRoot, format: "json" });
      expect(code).toBe(0);
    } finally {
      restore();
    }

    const payload = JSON.parse(lines.join("\n"));
    expect(payload.merged.env).toEqual({ FOO: "bar" });
    expect(payload.origins.env).toBe("project");
    expect(payload.layers.project.exists).toBe(true);
    expect(payload.layers.local.exists).toBe(false);
  });

  it("--layer restricts output to a single layer", async () => {
    const { home, projectRoot } = makeTree();
    writeFileSync(
      join(projectRoot, ".rookie", "settings.local.json"),
      JSON.stringify({ env: { ONLY: "local" } }),
    );

    const { lines, restore } = captureStdout();
    try {
      const code = await runConfigShow({ home, projectRoot, layer: "local" });
      expect(code).toBe(0);
    } finally {
      restore();
    }

    const output = lines.join("\n");
    expect(output).toContain("LOCAL");
    expect(output).toContain('"ONLY": "local"');
    expect(output).not.toContain("GLOBAL");
  });
});
