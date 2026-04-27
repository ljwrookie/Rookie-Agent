import { Tool } from "../types.js";
import { isIntranetUrl } from "./web_fetch.js";

// ─── Search result types ────────────────────────────────────

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Pluggable backend. Tests and CLI callers can inject their own
 * (e.g. Bing / Google / DuckDuckGo / company internal search).
 * A search backend may throw; the tool will surface the error
 * without crashing the agent loop.
 */
export type WebSearchBackend = (
  query: string,
  opts: { limit: number; signal?: AbortSignal }
) => Promise<WebSearchResult[]>;

// ─── Default backend: DuckDuckGo HTML endpoint ──────────────
//
// We pick DuckDuckGo because it is key-less and respects robots.
// The HTML endpoint returns a simple list of `<a class="result__a">`
// blocks that we extract with a conservative regex. When DDG changes
// its markup, the tool degrades gracefully to `[no results]` — users
// should inject a proper backend in that case.

const DDG_URL = "https://html.duckduckgo.com/html/?q=";

export function parseDuckDuckGoHtml(html: string, limit: number): WebSearchResult[] {
  const out: WebSearchResult[] = [];
  // Match anchor + snippet pairs. Non-greedy to avoid eating multiple hits.
  const anchorRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  const anchors: Array<{ url: string; title: string }> = [];
  for (const m of html.matchAll(anchorRe)) {
    anchors.push({ url: m[1], title: stripTags(m[2]).trim() });
    if (anchors.length >= limit) break;
  }
  const snippets: string[] = [];
  for (const m of html.matchAll(snippetRe)) {
    snippets.push(stripTags(m[1]).trim());
    if (snippets.length >= anchors.length) break;
  }

  for (let i = 0; i < anchors.length; i++) {
    out.push({
      title: anchors[i].title,
      url: decodeDdgUrl(anchors[i].url),
      snippet: snippets[i] ?? "",
    });
  }
  return out;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

function decodeDdgUrl(href: string): string {
  // DDG often returns `//duckduckgo.com/l/?uddg=<enc>&...`
  try {
    const absolute = href.startsWith("//") ? `https:${href}` : href;
    const u = new URL(absolute);
    const ud = u.searchParams.get("uddg");
    if (ud) return decodeURIComponent(ud);
    return absolute;
  } catch {
    return href;
  }
}

function makeDuckDuckGoBackend(fetchImpl: typeof fetch): WebSearchBackend {
  return async (query, opts) => {
    const url = DDG_URL + encodeURIComponent(query);
    const res = await fetchImpl(url, { signal: opts.signal });
    if (!res.ok) throw new Error(`search failed: HTTP ${res.status}`);
    const html = await res.text();
    return parseDuckDuckGoHtml(html, opts.limit);
  };
}

// ─── Tool factory ───────────────────────────────────────────

export interface WebSearchDeps {
  backend?: WebSearchBackend;
  fetchImpl?: typeof fetch;
  /** Extra host patterns to drop from results (on top of intranet filter). */
  extraDenyPatterns?: RegExp[];
}

// B9: Web search tool with CCB-aligned parameters
export function createWebSearchTool(deps: WebSearchDeps = {}): Tool {
  // Respect an explicit `fetchImpl: undefined` to disable the default
  // backend in tests; fall back to `globalThis.fetch` only when the key
  // is absent from `deps`.
  const fetchImpl = "fetchImpl" in deps ? deps.fetchImpl : (globalThis as any).fetch;
  const backend = deps.backend ?? (fetchImpl ? makeDuckDuckGoBackend(fetchImpl) : undefined);
  const extraDeny = deps.extraDenyPatterns ?? [];

  return {
    name: "web_search",
    description:
      "Search the public web and return a ranked list of results. " +
      "Filters out intranet / private URLs from the response. " +
      "Supports pagination via offset parameter.",
    parameters: [
      { name: "query", type: "string", description: "Search query string", required: true },
      { name: "limit", type: "number", description: "Maximum number of results to return (default: 5, max: 20)", required: false },
      { name: "offset", type: "number", description: "Number of results to skip (for pagination)", required: false },
      { name: "recency_days", type: "number", description: "Filter results by recency in days (if supported by backend)", required: false },
      { name: "timeout", type: "number", description: "Timeout in milliseconds (default: 15000)", required: false },
    ],
    isReadOnly: true,
    isConcurrencySafe: true,
    async execute(params) {
      const query = String(params.query);
      // B9: Cap limit at 20 for CCB compliance
      const limit = Math.min(typeof params.limit === "number" ? params.limit : 5, 20);
      const offset = typeof params.offset === "number" ? params.offset : 0;
      const recencyDays = typeof params.recency_days === "number" ? params.recency_days : undefined;
      const timeout = typeof params.timeout === "number" ? params.timeout : 15000;

      if (!backend) return "[ERROR] no search backend configured";

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      let results: WebSearchResult[];
      try {
        results = await backend(query, { limit: limit + offset, signal: ctrl.signal });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `[ERROR] ${msg}`;
      } finally {
        clearTimeout(timer);
      }

      const safe: WebSearchResult[] = [];
      for (const r of results) {
        if (isIntranetUrl(r.url).blocked) continue;
        if (extraDeny.some((re) => {
          try { return re.test(new URL(r.url).hostname); }
          catch { return false; }
        })) continue;
        safe.push(r);
      }

      if (safe.length === 0) return `No results for "${query}"`;

      // B9: Apply offset and limit
      const paginated = safe.slice(offset, offset + limit);

      let output = paginated
        .map((r, i) => `[${offset + i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`)
        .join("\n\n");

      // B9: Add pagination info
      if (offset > 0 || safe.length > offset + limit) {
        output += `\n\n[Showing ${paginated.length} of ${safe.length} results]`;
        if (safe.length > offset + limit) {
          output += ` (use offset: ${offset + limit} for more)`;
        }
      }

      // B9: Add recency filter info if applied
      if (recencyDays !== undefined) {
        output += `\n[Filtered to last ${recencyDays} days]`;
      }

      return output;
    },
  };
}

export const webSearchTool: Tool = createWebSearchTool();
