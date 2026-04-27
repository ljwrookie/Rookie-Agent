import { describe, it, expect } from "vitest";
import { HookRegistry, type HookFetch } from "../src/hooks/registry.js";

type Call = { url: string; method?: string; headers?: Record<string, string>; body?: string };

function makeFetch(responses: Array<{ status: number; body: string } | "network-error">): {
  fetchImpl: HookFetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl: HookFetch = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r === "network-error") throw new Error("boom");
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: async () => r.body,
    };
  };
  return { fetchImpl, calls };
}

describe("HookRegistry HTTP", () => {
  it("POSTs JSON body and returns response text", async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200, body: "ok" }]);
    const reg = new HookRegistry({ fetchImpl });

    reg.register({ event: "SessionStart", url: "https://example/hook" });
    const results = await reg.fire("SessionStart", {
      sessionId: "s1",
      projectRoot: "/tmp",
    });

    expect(results[0].success).toBe(true);
    expect(results[0].output).toBe("ok");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example/hook");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers!["content-type"]).toBe("application/json");
    const payload = JSON.parse(calls[0].body!);
    expect(payload.event).toBe("SessionStart");
    expect(payload.context.sessionId).toBe("s1");
  });

  it("retries on 5xx then succeeds", async () => {
    const { fetchImpl, calls } = makeFetch([
      { status: 502, body: "gateway" },
      { status: 200, body: "ok" },
    ]);
    const reg = new HookRegistry({ fetchImpl });

    reg.register({ event: "SessionStart", url: "https://example/hook", retries: 2 });
    const results = await reg.fire("SessionStart", { sessionId: "s1", projectRoot: "/tmp" });

    expect(results[0].success).toBe(true);
    expect(calls.length).toBe(2);
  });

  it("retries on network error up to max and surfaces failure", async () => {
    const { fetchImpl, calls } = makeFetch(["network-error", "network-error", "network-error"]);
    const reg = new HookRegistry({ fetchImpl });

    reg.register({ event: "PreToolUse", url: "https://example/hook", retries: 2, canReject: true });
    const results = await reg.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "anything",
      projectRoot: "/tmp",
    });

    expect(calls.length).toBe(3);              // 1 + 2 retries
    expect(results[0].success).toBe(false);
    expect(results[0].rejected).toBe(true);     // canReject surfaces as rejection
  });

  it("does NOT retry on 4xx", async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 400, body: "bad" }, { status: 200, body: "ok" }]);
    const reg = new HookRegistry({ fetchImpl });

    reg.register({ event: "PreToolUse", url: "https://example/hook", retries: 5 });
    const results = await reg.fire("PreToolUse", {
      sessionId: "s1",
      toolName: "anything",
      projectRoot: "/tmp",
    });

    expect(calls.length).toBe(1);
    expect(results[0].success).toBe(false);
    expect(results[0].output).toMatch(/HTTP 400/);
  });

  it("applies custom headers and method", async () => {
    const { fetchImpl, calls } = makeFetch([{ status: 200, body: "" }]);
    const reg = new HookRegistry({ fetchImpl });

    reg.register({
      event: "SessionStart",
      url: "https://example/hook",
      method: "GET",
      headers: { "x-token": "abc" },
    });
    await reg.fire("SessionStart", { sessionId: "s1", projectRoot: "/tmp" });

    expect(calls[0].method).toBe("GET");
    expect(calls[0].headers!["x-token"]).toBe("abc");
    expect(calls[0].body).toBeUndefined();
  });
});
