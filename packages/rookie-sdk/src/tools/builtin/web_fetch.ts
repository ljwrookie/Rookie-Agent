import { Tool } from "../types.js";

// ─── Intranet / private-host denial ─────────────────────────
//
// Enterprise compliance: refuse to fetch URLs that resolve to private
// IPv4 / IPv6 ranges, or that match well-known intranet hostnames.
// We perform a *syntactic* check based on the URL itself; resolving the
// hostname would add latency and is not required for the v1 policy.
// Hosts that evade this (e.g. public DNS entries pointing at RFC1918
// space) are a known gap.

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /\.corp(\.|$)/i,
  /\.byted\.org$/i,
  /\.bytedance\.net$/i,
  /\.bytedance\.com$/i,
];

// RFC1918 / loopback / link-local / CGNAT / ULA ranges.
function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;                   // 10.0.0.0/8
  if (a === 127) return true;                  // loopback
  if (a === 0) return true;                    // this-network
  if (a === 169 && b === 254) return true;     // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;     // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  return false;
}

function isPrivateIPv6(host: string): boolean {
  // strip surrounding brackets
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1") return true;                  // loopback
  if (h.startsWith("fe80:")) return true;        // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // ULA fc00::/7
  if (h.startsWith("::ffff:")) {
    // IPv4-mapped — delegate to v4 check
    const v4 = h.slice("::ffff:".length);
    return isPrivateIPv4(v4);
  }
  return false;
}

export function isIntranetUrl(url: string): { blocked: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { blocked: true, reason: "invalid URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { blocked: true, reason: `unsupported protocol ${parsed.protocol}` };
  }
  const host = parsed.hostname;
  if (!host) return { blocked: true, reason: "missing host" };
  if (isPrivateIPv4(host)) return { blocked: true, reason: `private IPv4 ${host}` };
  if (isPrivateIPv6(host)) return { blocked: true, reason: `private IPv6 ${host}` };
  for (const re of PRIVATE_HOST_PATTERNS) {
    if (re.test(host)) return { blocked: true, reason: `intranet host ${host}` };
  }
  return { blocked: false };
}

// ─── Tool definition ────────────────────────────────────────

export interface WebFetchDeps {
  /** Override fetch for tests. Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Additional host patterns to deny (merged with built-ins). */
  extraDenyPatterns?: RegExp[];
}

const MAX_BYTES = 1 * 1024 * 1024;        // 1 MB
const DEFAULT_TIMEOUT = 15_000;            // 15 s

// B9: Web fetch tool with CCB-aligned parameters
export function createWebFetchTool(deps: WebFetchDeps = {}): Tool {
  const fetchImpl = deps.fetchImpl ?? (globalThis as any).fetch;
  const extraDeny = deps.extraDenyPatterns ?? [];
  return {
    name: "web_fetch",
    description:
      "Fetch a public URL over HTTP(S) with intranet denial. " +
      "Returns the body as text; truncated at 1 MB. Non-2xx responses are returned with status info. " +
      "Supports HTML to markdown conversion and raw HTML output.",
    parameters: [
      { name: "url", type: "string", description: "URL to fetch", required: true },
      { name: "timeout", type: "number", description: "Timeout in milliseconds (default: 15000)", required: false },
      { name: "headers", type: "object", description: "Additional HTTP headers to send", required: false },
      { name: "max_length", type: "number", description: "Maximum characters to return (default: 10000)", required: false },
      { name: "start_index", type: "number", description: "Character offset to start from (for pagination)", required: false },
      { name: "raw", type: "boolean", description: "Return raw HTML instead of markdown (default: false)", required: false },
    ],
    isReadOnly: true,
    isConcurrencySafe: true,
    async execute(params) {
      const url = String(params.url);
      const timeout = typeof params.timeout === "number" ? params.timeout : DEFAULT_TIMEOUT;
      const headers = (params.headers as Record<string, string>) || {};
      // B9: Support CCB parameters
      const maxLength = typeof params.max_length === "number" ? params.max_length : 10000;
      const startIndex = typeof params.start_index === "number" ? params.start_index : 0;
      const raw = typeof params.raw === "boolean" ? params.raw : false;

      const gate = isIntranetUrl(url);
      if (gate.blocked) return `[BLOCKED] ${gate.reason}`;

      // Extra deny list on hostname.
      try {
        const host = new URL(url).hostname;
        for (const re of extraDeny) {
          if (re.test(host)) return `[BLOCKED] denied by policy: ${host}`;
        }
      } catch { /* already checked above */ }

      if (!fetchImpl) return "[ERROR] no fetch implementation available in this runtime";

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetchImpl(url, { headers, signal: ctrl.signal });
        const status = res.status;
        const ct = res.headers.get("content-type") || "";
        let reader = await res.text();

        // B9: Convert HTML to markdown if content-type is HTML and raw is false
        if (!raw && ct.includes("text/html")) {
          reader = htmlToMarkdown(reader);
        }

        // B9: Apply start_index and max_length
        const totalLength = reader.length;
        if (startIndex > 0) {
          reader = reader.slice(startIndex);
        }
        if (reader.length > maxLength) {
          reader = reader.slice(0, maxLength) + `\n\n[... truncated, showing ${maxLength} of ${totalLength} characters]`;
        }

        // B9: Also respect MAX_BYTES for initial fetch
        if (reader.length > MAX_BYTES) {
          reader = reader.slice(0, MAX_BYTES) + `\n... [truncated at ${MAX_BYTES} bytes]`;
        }

        return `HTTP ${status} (${ct})\n\n${reader}`;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return `[ERROR] fetch failed: ${msg}`;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// B9: Simple HTML to markdown converter
function htmlToMarkdown(html: string): string {
  let md = html;

  // Remove script and style tags
  md = md.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  md = md.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Convert common HTML elements to markdown
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n\n");
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n\n");
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n\n");
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n\n");
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n");
  md = md.replace(/<br\s*\/?>/gi, "\n");
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**");
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, "**$1**");
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, "*$1*");
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, "*$1*");
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, "`$1`");
  md = md.replace(/<a[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)");
  md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n");

  // Remove remaining HTML tags
  md = md.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  md = md.replace(/&lt;/g, "<");
  md = md.replace(/&gt;/g, ">");
  md = md.replace(/&amp;/g, "&");
  md = md.replace(/&quot;/g, '"');
  md = md.replace(/&#39;/g, "'");
  md = md.replace(/&nbsp;/g, " ");

  // Normalize whitespace
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.trim();

  return md;
}

/** Default tool instance bound to the global fetch. */
export const webFetchTool: Tool = createWebFetchTool();
