import { describe, it, expect, vi } from "vitest";
import { isIntranetUrl, createWebFetchTool } from "../src/tools/builtin/web_fetch.js";

describe("isIntranetUrl", () => {
  it("allows public http(s) hosts", () => {
    expect(isIntranetUrl("https://example.com/path").blocked).toBe(false);
    expect(isIntranetUrl("http://1.1.1.1/").blocked).toBe(false);
  });

  it("blocks invalid and non-http protocols", () => {
    expect(isIntranetUrl("not a url").blocked).toBe(true);
    expect(isIntranetUrl("file:///etc/passwd").blocked).toBe(true);
    expect(isIntranetUrl("ftp://ftp.example.com").blocked).toBe(true);
  });

  it("blocks localhost + loopback", () => {
    expect(isIntranetUrl("http://localhost/").reason).toMatch(/intranet|private/);
    expect(isIntranetUrl("http://127.0.0.1/").reason).toMatch(/private IPv4/);
    expect(isIntranetUrl("http://[::1]/").reason).toMatch(/private IPv6/);
  });

  it("blocks RFC1918 ranges", () => {
    expect(isIntranetUrl("http://10.0.0.5/").blocked).toBe(true);
    expect(isIntranetUrl("http://192.168.1.1/").blocked).toBe(true);
    expect(isIntranetUrl("http://172.20.0.1/").blocked).toBe(true);
    expect(isIntranetUrl("http://172.33.0.1/").blocked).toBe(false); // outside 12/16
  });

  it("blocks known intranet suffixes", () => {
    expect(isIntranetUrl("https://foo.byted.org/").blocked).toBe(true);
    expect(isIntranetUrl("https://foo.bytedance.net/").blocked).toBe(true);
    expect(isIntranetUrl("https://service.local/").blocked).toBe(true);
  });
});

describe("web_fetch tool", () => {
  it("refuses blocked URLs without calling fetch", async () => {
    const fetchSpy = vi.fn();
    const tool = createWebFetchTool({ fetchImpl: fetchSpy as any });
    const out = await tool.execute({ url: "http://localhost/" });
    expect(String(out)).toMatch(/\[BLOCKED\]/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches and returns body for allowed URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => "hello",
    });
    const tool = createWebFetchTool({ fetchImpl: fetchSpy as any });
    const out = String(await tool.execute({ url: "https://example.com/ok" }));
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(out).toContain("HTTP 200");
    expect(out).toContain("hello");
  });

  it("applies extra deny patterns", async () => {
    const fetchSpy = vi.fn();
    const tool = createWebFetchTool({
      fetchImpl: fetchSpy as any,
      extraDenyPatterns: [/malicious\.example$/],
    });
    const out = String(await tool.execute({ url: "https://malicious.example/x" }));
    expect(out).toMatch(/\[BLOCKED\]/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("truncates oversized responses", async () => {
    const big = "x".repeat(1_048_600); // just over 1 MB
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 200,
      headers: { get: () => "text/plain" },
      text: async () => big,
    });
    const tool = createWebFetchTool({ fetchImpl: fetchSpy as any });
    const out = String(await tool.execute({ url: "https://example.com/big" }));
    expect(out).toContain("[truncated");
  });
});
