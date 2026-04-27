import { describe, it, expect } from "vitest";
import {
  Compactor,
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  defaultSummariser,
  type Summariser,
} from "../src/agent/compactor.js";
import type { Message } from "../src/agent/types.js";
import { HookRegistry } from "../src/hooks/registry.js";
import { MemoryStore } from "../src/memory/store.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeLong(role: Message["role"], chars: number, prefix = ""): Message {
  return { role, content: prefix + "x".repeat(chars) };
}

function turn(userLen: number, assistantLen: number, tag: string): Message[] {
  return [
    { role: "user", content: `[${tag}] ` + "a".repeat(userLen) },
    { role: "assistant", content: `[${tag}] ` + "b".repeat(assistantLen) },
  ];
}

// ── Token estimation ───────────────────────────────────────────────

describe("token estimation", () => {
  it("estimateTokens approximates chars / 4", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("hello")).toBe(2); // ceil(5/4)
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("estimateMessageTokens adds structural overhead + tool call payload", () => {
    const msg: Message = {
      role: "assistant",
      content: "ok",
      toolCalls: [{ id: "1", name: "shell_execute", params: { cmd: "ls" } }],
    };
    const t = estimateMessageTokens(msg);
    // 1 (content) + 3 (name) + 4 (json) + 4 overhead ≈ 12 — generous but > 4.
    expect(t).toBeGreaterThan(4);
  });

  it("estimateTotalTokens sums across messages", () => {
    const msgs: Message[] = [
      { role: "user", content: "a".repeat(400) },
      { role: "assistant", content: "b".repeat(400) },
    ];
    const total = estimateTotalTokens(msgs);
    // Each message ~ 100 content tokens + 4 overhead; total ≈ 208.
    expect(total).toBeGreaterThan(200);
    expect(total).toBeLessThan(220);
  });
});

// ── shouldCompact / threshold ──────────────────────────────────────

describe("Compactor.shouldCompact", () => {
  it("returns false below the trigger ratio", () => {
    const c = new Compactor({ contextWindow: 1000, triggerRatio: 0.8 });
    const msgs: Message[] = [makeLong("user", 400)];
    // ~100 + 4 tokens — well below 800.
    expect(c.shouldCompact(msgs)).toBe(false);
  });

  it("returns true above the trigger ratio", () => {
    const c = new Compactor({ contextWindow: 1000, triggerRatio: 0.8 });
    // ~10 * 400 chars → ~1040 tokens, above the 800 threshold.
    const msgs: Message[] = Array.from({ length: 10 }, (_, i) => makeLong("user", 400, `${i}:`));
    expect(c.shouldCompact(msgs)).toBe(true);
  });

  it("exposes the computed trigger token count", () => {
    const c = new Compactor({ contextWindow: 2000, triggerRatio: 0.75 });
    expect(c.triggerTokens).toBe(1500);
  });

  it("clamps out-of-range ratios", () => {
    const low = new Compactor({ contextWindow: 1000, triggerRatio: 0 });
    expect(low.triggerTokens).toBe(10); // 0.01 * 1000
    const high = new Compactor({ contextWindow: 1000, triggerRatio: 2 });
    expect(high.triggerTokens).toBe(990); // 0.99 * 1000
  });

  it("rejects non-positive contextWindow", () => {
    expect(() => new Compactor({ contextWindow: 0 })).toThrow();
    expect(() => new Compactor({ contextWindow: -1 })).toThrow();
  });
});

// ── compact / forceCompact ─────────────────────────────────────────

describe("Compactor.compact", () => {
  it("keeps the system prefix and the N most recent messages verbatim", async () => {
    const summariser: Summariser = async () => "summary of older";
    const c = new Compactor({ contextWindow: 100, keepRecent: 2, summariser });

    // 1 system + 8 body messages; keepRecent=2 → 6 messages get summarised.
    const history: Message[] = [
      { role: "system", content: "sys prompt" },
      ...turn(20, 20, "t1"),
      ...turn(20, 20, "t2"),
      ...turn(20, 20, "t3"),
      ...turn(20, 20, "t4"),
    ];

    const result = await c.forceCompact(history);

    // system + summary + 2 recent = 4 messages
    expect(result.messages).toHaveLength(4);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[0].content).toBe("sys prompt");
    expect(result.messages[1].role).toBe("system");
    expect(result.messages[1].content).toContain("summary of older");
    // Last two recent messages should be the t4 turn verbatim.
    expect(result.messages[2].content).toContain("[t4]");
    expect(result.messages[3].content).toContain("[t4]");
    expect(result.before.messages).toBe(9);
    expect(result.after.messages).toBe(4);
    expect(result.reason).toBe("manual");
  });

  it("returns the original array when body is shorter than keepRecent", async () => {
    const c = new Compactor({ contextWindow: 100, keepRecent: 10 });
    const history: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ];
    const result = await c.forceCompact(history);
    expect(result.messages).toBe(history); // identity: nothing to summarise
    expect(result.summary).toBe("");
  });

  it("persists the summary to MemoryStore.curated", async () => {
    const memory = new MemoryStore(`/tmp/rookie-compactor-${Date.now()}.db`);
    const summariser: Summariser = async () => "the summary text";
    const c = new Compactor({
      contextWindow: 100,
      keepRecent: 1,
      summariser,
      memory,
      sessionId: "sess-abc",
    });
    const history: Message[] = [
      ...turn(20, 20, "a"),
      ...turn(20, 20, "b"),
      ...turn(20, 20, "c"),
    ];
    const result = await c.forceCompact(history);
    expect(result.summaryId).toMatch(/^compact_sess-abc_/);
    const hits = await memory.searchCurated("summary", 5);
    expect(hits.some((h) => h.id === result.summaryId)).toBe(true);
    await memory.close();
  });

  it("fires PreCompact and PostCompact hooks with before/after counts", async () => {
    const hooks = new HookRegistry();
    const fired: Array<{ event: string; compaction: unknown }> = [];
    // Use register with a command; but we want to observe directly — monkey
    // patch fire instead to capture the context without shelling out.
    const originalFire = hooks.fire.bind(hooks);
    hooks.fire = async (event, ctx) => {
      fired.push({ event, compaction: ctx.compaction });
      return originalFire(event, ctx);
    };

    const c = new Compactor({
      contextWindow: 100,
      keepRecent: 1,
      hooks,
      sessionId: "s-hk",
    });
    const history: Message[] = [...turn(20, 20, "a"), ...turn(20, 20, "b")];
    await c.forceCompact(history);

    const events = fired.map((f) => f.event);
    expect(events).toContain("PreCompact");
    expect(events).toContain("PostCompact");

    const pre = fired.find((f) => f.event === "PreCompact")!;
    const post = fired.find((f) => f.event === "PostCompact")!;
    // Both carry `before`; Post additionally carries `after`.
    expect((pre.compaction as { before: object }).before).toBeDefined();
    expect((post.compaction as { after: object }).after).toBeDefined();
    expect((post.compaction as { reason: string }).reason).toBe("manual");
  });

  it("maybeCompact() is a no-op under threshold", async () => {
    const c = new Compactor({ contextWindow: 10000, keepRecent: 2 });
    const msgs: Message[] = [{ role: "user", content: "short" }];
    expect(await c.maybeCompact(msgs)).toBeNull();
  });

  it("maybeCompact() compacts over threshold with reason=threshold", async () => {
    const summariser: Summariser = async () => "compressed";
    const c = new Compactor({
      contextWindow: 200,
      keepRecent: 1,
      triggerRatio: 0.5,
      summariser,
    });
    const history: Message[] = [
      makeLong("user", 300, "u1:"),
      makeLong("assistant", 300, "a1:"),
      makeLong("user", 300, "u2:"),
      makeLong("assistant", 300, "a2:"),
    ];
    const result = await c.maybeCompact(history);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe("threshold");
    expect(result!.after.tokens).toBeLessThan(result!.before.tokens);
  });
});

// ── defaultSummariser ──────────────────────────────────────────────

describe("defaultSummariser", () => {
  it("produces a deterministic bullet summary", async () => {
    const msgs: Message[] = [
      { role: "user", content: "please ship the feature" },
      { role: "assistant", content: "on it", toolCalls: [{ id: "1", name: "file_read", params: { path: "README.md" } }] },
      { role: "tool", content: "ok", tool_call_id: "1" },
      { role: "assistant", content: "done, summary attached." },
    ];
    const out = await defaultSummariser(msgs);
    expect(out).toContain("4 older messages compacted");
    expect(out).toContain("file_read×1");
    expect(out).toContain("First ask: please ship the feature");
  });
});
