// ─── Shared Formatting Utilities ─────────────────────────────────
// Extracted from multiple components to eliminate duplication.
// Fixes: #12 shortDir duplication, #13 fmtTime/fmtDuration duplication

export function shortDir(dir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && dir.startsWith(home)) return "~" + dir.slice(home.length);
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 2) return dir;
  return ".../" + parts.slice(-2).join("/");
}

export function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return parts.slice(-2).join("/");
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
}

export function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}
