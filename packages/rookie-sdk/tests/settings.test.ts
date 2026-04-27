import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deepMerge,
  loadSettings,
  resolveSettingsPaths,
} from "../src/config/settings.js";

function makeTree(): { home: string; projectRoot: string } {
  const root = mkdtempSync(join(tmpdir(), "rookie-settings-"));
  const home = join(root, "home");
  const projectRoot = join(root, "repo");
  mkdirSync(join(home, ".rookie"), { recursive: true });
  mkdirSync(join(projectRoot, ".rookie"), { recursive: true });
  return { home, projectRoot };
}

function writeLayer(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}

describe("resolveSettingsPaths", () => {
  it("maps home + projectRoot to the three default files", () => {
    const paths = resolveSettingsPaths({ home: "/h", projectRoot: "/p" });
    expect(paths.global).toBe("/h/.rookie/settings.json");
    expect(paths.project).toBe("/p/.rookie/settings.json");
    expect(paths.local).toBe("/p/.rookie/settings.local.json");
  });
});

describe("deepMerge", () => {
  it("scalars: higher wins, undefined never clobbers", () => {
    const out = deepMerge({ a: 1, b: 2 }, { a: 9, b: undefined as unknown as number });
    expect(out).toEqual({ a: 9, b: 2 });
  });

  it("plain objects merge recursively", () => {
    const out = deepMerge(
      { model: { default: "gpt", providers: { openai: { k: 1 } } } },
      { model: { providers: { openai: { k: 2 }, anthropic: { k: 3 } } } },
    );
    expect(out).toEqual({
      model: {
        default: "gpt",
        providers: { openai: { k: 2 }, anthropic: { k: 3 } },
      },
    });
  });

  it("arrays: higher entries prepend, duplicates de-duped by JSON identity", () => {
    const out = deepMerge(
      { permissions: [{ tool: "a", action: "allow" }, { tool: "b", action: "ask" }] },
      { permissions: [{ tool: "b", action: "ask" }, { tool: "c", action: "deny" }] },
    );
    expect(out.permissions).toEqual([
      { tool: "b", action: "ask" },
      { tool: "c", action: "deny" },
      { tool: "a", action: "allow" },
    ]);
  });
});

describe("loadSettings", () => {
  it("returns empty layers when nothing exists", async () => {
    const { home, projectRoot } = makeTree();
    const result = await loadSettings({ home, projectRoot });
    expect(result.merged).toEqual({});
    expect(result.layers.global.exists).toBe(false);
    expect(result.layers.project.exists).toBe(false);
    expect(result.layers.local.exists).toBe(false);
  });

  it("merges global → project → local with correct precedence", async () => {
    const { home, projectRoot } = makeTree();
    const paths = resolveSettingsPaths({ home, projectRoot });

    writeLayer(paths.global, {
      permissions: [{ tool: "file_read", action: "allow" }],
      logging: { level: "info" },
    });
    writeLayer(paths.project, {
      permissions: [{ tool: "file_edit", action: "ask" }],
      logging: { level: "debug", path: "log/app.jsonl" },
    });
    writeLayer(paths.local, {
      permissions: [{ tool: "shell_execute", action: "allow" }],
      logging: { level: "warn" },
    });

    const result = await loadSettings({ home, projectRoot });

    // Local "warn" beats project "debug" beats global "info".
    expect(result.merged.logging).toEqual({ level: "warn", path: "log/app.jsonl" });

    // Arrays: local prepends, then project, then global (in that order).
    expect(result.merged.permissions).toEqual([
      { tool: "shell_execute", action: "allow" },
      { tool: "file_edit", action: "ask" },
      { tool: "file_read", action: "allow" },
    ]);

    // Origins point to the highest layer that defined each key.
    expect(result.origins.permissions).toBe("local");
    expect(result.origins.logging).toBe("local");
  });

  it("origins fall back to the highest layer that defined the key", async () => {
    const { home, projectRoot } = makeTree();
    const paths = resolveSettingsPaths({ home, projectRoot });
    writeLayer(paths.global, { env: { FOO: "bar" } });
    writeLayer(paths.project, { skills: { enabled: ["x"] } });
    // local layer intentionally absent

    const result = await loadSettings({ home, projectRoot });
    expect(result.origins.env).toBe("global");
    expect(result.origins.skills).toBe("project");
  });

  it("malformed JSON is treated as an empty layer (non-fatal)", async () => {
    const { home, projectRoot } = makeTree();
    const paths = resolveSettingsPaths({ home, projectRoot });
    writeFileSync(paths.project, "{ this is not json");
    writeLayer(paths.local, { env: { OK: "1" } });

    const result = await loadSettings({ home, projectRoot });
    expect(result.merged).toEqual({ env: { OK: "1" } });
    expect(result.layers.project.exists).toBe(false);
  });
});
