import { describe, it, expect, vi } from "vitest";
import { createWebSearchTool, parseDuckDuckGoHtml } from "../src/tools/builtin/web_search.js";

describe("parseDuckDuckGoHtml", () => {
  it("extracts anchor titles and snippets", () => {
    const html = `
      <div><a class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent("https://a.com/")}&rut=x">Title A</a>
      <a class="result__snippet" href="#">Snippet A</a></div>
      <div><a class="result__a" href="https://b.com/">Title B</a>
      <a class="result__snippet" href="#">Snippet B</a></div>
    `;
    const results = parseDuckDuckGoHtml(html, 5);
    expect(results.length).toBe(2);
    expect(results[0]).toMatchObject({ title: "Title A", url: "https://a.com/", snippet: "Snippet A" });
    expect(results[1].url).toBe("https://b.com/");
  });
});

describe("web_search tool", () => {
  it("uses injected backend and filters intranet URLs", async () => {
    const backend = vi.fn().mockResolvedValue([
      { title: "Public", url: "https://example.com/x", snippet: "pub" },
      { title: "Intranet", url: "http://localhost/admin", snippet: "bad" },
    ]);
    const tool = createWebSearchTool({ backend });
    const out = String(await tool.execute({ query: "hi", limit: 5 }));
    expect(backend).toHaveBeenCalled();
    expect(out).toContain("Public");
    expect(out).not.toContain("localhost");
  });

  it("returns message when no backend configured", async () => {
    const tool = createWebSearchTool({ fetchImpl: undefined });
    const out = String(await tool.execute({ query: "hi" }));
    expect(out).toMatch(/\[ERROR\]/);
  });

  it("bubbles backend errors", async () => {
    const backend = vi.fn().mockRejectedValue(new Error("boom"));
    const tool = createWebSearchTool({ backend });
    const out = String(await tool.execute({ query: "q" }));
    expect(out).toMatch(/\[ERROR\] boom/);
  });

  it("applies extra deny patterns on hostnames", async () => {
    const backend = vi.fn().mockResolvedValue([
      { title: "OK", url: "https://ok.com/", snippet: "" },
      { title: "Bad", url: "https://bad.com/", snippet: "" },
    ]);
    const tool = createWebSearchTool({ backend, extraDenyPatterns: [/^bad\.com$/] });
    const out = String(await tool.execute({ query: "q" }));
    expect(out).toContain("ok.com");
    expect(out).not.toContain("bad.com");
  });

  it("returns \"no results\" when all filtered", async () => {
    const backend = vi.fn().mockResolvedValue([
      { title: "X", url: "http://localhost/", snippet: "" },
    ]);
    const tool = createWebSearchTool({ backend });
    const out = String(await tool.execute({ query: "q" }));
    expect(out).toMatch(/No results/);
  });
});
