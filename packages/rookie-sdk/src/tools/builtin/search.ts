import { Tool } from "../types.js";

/**
 * search_code: Searches code using the Rust-powered tantivy full-text index.
 *
 * The tool expects a `_rookieClient` to be injected via params at runtime
 * (set by the agent context). If not available, falls back to grep.
 */
export const searchCodeTool: Tool = {
  name: "search_code",
  description:
    "Search code in the project using full-text search. " +
    "Returns matching file paths, scores, and snippets. " +
    "Use this to find relevant code, definitions, or usages.",
  parameters: [
    { name: "query", type: "string", description: "Search query (keywords or phrases)", required: true },
    { name: "limit", type: "number", description: "Max results to return (default 10)", required: false },
    { name: "cwd", type: "string", description: "Project root directory", required: false },
  ],
  async execute(params) {
    const query = String(params.query);
    const limit = typeof params.limit === "number" ? params.limit : 10;
    const cwd = params.cwd ? String(params.cwd) : process.cwd();

    // Try to use RookieClient if available (injected by agent context)
    const client = (params as any)._rookieClient;
    if (client) {
      try {
        const result = await client.index.search(query, limit);
        if (result.results.length === 0) {
          return `No results found for "${query}"`;
        }
        return result.results
          .map((r: any) => `${r.path} (score: ${r.score.toFixed(3)})\n  ${r.snippet?.slice(0, 150)}`)
          .join("\n\n");
      } catch {
        // Fall through to grep fallback
      }
    }

    // Fallback: use grep
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      const { stdout } = await execAsync(
        `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.py" --include="*.rs" --include="*.go" -l "${query.replace(/"/g, '\\"')}" . | head -${limit}`,
        { cwd, timeout: 10000, maxBuffer: 1024 * 512 }
      );

      if (!stdout.trim()) {
        return `No results found for "${query}"`;
      }

      return `Files matching "${query}":\n${stdout}`;
    } catch {
      return `No results found for "${query}" (grep fallback also failed)`;
    }
  },
};
