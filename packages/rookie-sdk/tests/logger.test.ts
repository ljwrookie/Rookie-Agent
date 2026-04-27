import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger, parseLogEvent, LOG_LEVEL_ORDER } from "../src/logger/index.js";

function tmp(prefix = "rookie-log-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("Logger", () => {
  it("writes JSONL records that include ts/level/msg and base fields", () => {
    const dir = tmp();
    const fixed = new Date("2026-04-23T10:00:00.000Z");
    const log = new Logger({ dir, base: { sessionId: "s-42" }, now: () => fixed });
    log.info("session.start");
    log.info("tool.invoke", { tool: "file_read", duration: 12 });

    const file = join(dir, "app.2026-04-23.log.jsonl");
    expect(existsSync(file)).toBe(true);
    const lines = readFileSync(file, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.level).toBe("info");
    expect(first.msg).toBe("session.start");
    expect(first.sessionId).toBe("s-42");
    expect(first.ts).toBe("2026-04-23T10:00:00.000Z");

    const second = JSON.parse(lines[1]);
    expect(second.tool).toBe("file_read");
    expect(second.duration).toBe(12);
  });

  it("suppresses records below the configured threshold", () => {
    const dir = tmp();
    const log = new Logger({ dir, level: "warn" });
    log.info("skipped");
    log.warn("kept");

    const file = join(dir, `app.${new Date().toISOString().slice(0, 10)}.log.jsonl`);
    const content = readFileSync(file, "utf-8").trim().split("\n");
    expect(content).toHaveLength(1);
    expect(JSON.parse(content[0]).msg).toBe("kept");
  });

  it("child() inherits base fields and layers extras", () => {
    const dir = tmp();
    const captured: unknown[] = [];
    const log = new Logger({
      dir: null,
      base: { sessionId: "s-1" },
      sink: (r) => { captured.push(r); },
    });
    const child = log.child({ agent: "coder" });
    child.info("hello", { tool: "bash" });

    expect(captured).toHaveLength(1);
    const r = captured[0] as Record<string, unknown>;
    expect(r.sessionId).toBe("s-1");
    expect(r.agent).toBe("coder");
    expect(r.tool).toBe("bash");
    expect(r.msg).toBe("hello");
  });

  it("swallows sink exceptions to avoid cascading failures", () => {
    const dir = tmp();
    const log = new Logger({
      dir,
      sink: () => { throw new Error("boom"); },
    });
    expect(() => log.info("still works")).not.toThrow();
  });

  it("exposes LOG_LEVEL_ORDER in expected ascending order", () => {
    expect(LOG_LEVEL_ORDER.trace).toBeLessThan(LOG_LEVEL_ORDER.debug);
    expect(LOG_LEVEL_ORDER.debug).toBeLessThan(LOG_LEVEL_ORDER.info);
    expect(LOG_LEVEL_ORDER.info).toBeLessThan(LOG_LEVEL_ORDER.warn);
    expect(LOG_LEVEL_ORDER.warn).toBeLessThan(LOG_LEVEL_ORDER.error);
    expect(LOG_LEVEL_ORDER.error).toBeLessThan(LOG_LEVEL_ORDER.fatal);
  });
});

describe("parseLogEvent", () => {
  it("returns null for non-object or missing msg", () => {
    expect(parseLogEvent(null)).toBeNull();
    expect(parseLogEvent(42)).toBeNull();
    expect(parseLogEvent({ level: "info" })).toBeNull();
  });

  it("fills defaults and preserves custom fields", () => {
    const rec = parseLogEvent({
      msg: "rpc.complete",
      method: "index.build",
      duration_ms: 42,
    });
    expect(rec?.level).toBe("info");
    expect(rec?.msg).toBe("rpc.complete");
    expect(rec?.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((rec as Record<string, unknown>).method).toBe("index.build");
    expect((rec as Record<string, unknown>).duration_ms).toBe(42);
  });
});
