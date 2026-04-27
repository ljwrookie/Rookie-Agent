import { describe, it, expect, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs/promises";
import { MemoryStore } from "../src/memory/store.js";

describe("MemoryStore (in-memory fallback)", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "rookie-mem-"));
  });

  it("save + load session", async () => {
    const store = new MemoryStore(path.join(tmp, "mem.db"));
    await store.save("s1", [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ]);
    const msgs = await store.load("s1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe("hello");
  });

  it("load returns empty array for unknown session", async () => {
    const store = new MemoryStore(path.join(tmp, "mem.db"));
    const msgs = await store.load("unknown");
    expect(msgs).toEqual([]);
  });

  it("saveCurated + searchCurated", async () => {
    const store = new MemoryStore(path.join(tmp, "mem.db"));
    await store.saveCurated({
      id: "m1",
      type: "build_command",
      content: "pnpm build --filter sdk",
      confidence: 0.9,
      source: "test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
    });
    const hits = await store.searchCurated("pnpm build", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].content).toContain("pnpm build");
  });

  it("getCuratedByType filters by type", async () => {
    const store = new MemoryStore(path.join(tmp, "mem.db"));
    await store.saveCurated({
      id: "a",
      type: "preference",
      content: "prefers pnpm",
      confidence: 0.8,
      source: "test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
    });
    await store.saveCurated({
      id: "b",
      type: "build_command",
      content: "cargo build",
      confidence: 0.8,
      source: "test",
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
    });
    const prefs = await store.getCuratedByType("preference", 10);
    expect(prefs.length).toBe(1);
    expect(prefs[0].content).toContain("pnpm");
  });
});
