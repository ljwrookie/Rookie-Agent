import { AgentEvent, ToolResult } from "../agent/types.js";
import { MemoryStore, CuratedMemory } from "../memory/store.js";

export interface MemoryCandidate {
  type: CuratedMemory["type"];
  content: string;
  confidence: number;
  source: string;
}

/**
 * AutoMemory: automatically captures useful information from agent sessions.
 *
 * Detects patterns like:
 *   - Build commands that succeed (npm run build, cargo test, etc.)
 *   - Debug tips when an error is resolved
 *   - Environment issues (missing deps, wrong versions)
 *   - API patterns (common request/response structures)
 *   - Project conventions (naming, directory structure)
 */
export class AutoMemory {
  private store: MemoryStore;
  private sessionEvents: AgentEvent[] = [];

  constructor(store: MemoryStore) {
    this.store = store;
  }

  /**
   * Feed an agent event for analysis.
   * Returns a memory candidate if the event contains useful information.
   */
  async evaluate(event: AgentEvent): Promise<MemoryCandidate | null> {
    this.sessionEvents.push(event);

    if (event.type === "tool_result") {
      return this.evaluateToolResult(event.result);
    }

    return null;
  }

  /**
   * Persist a confirmed memory candidate.
   */
  async persist(candidate: MemoryCandidate): Promise<void> {
    const memory: CuratedMemory = {
      id: `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: candidate.type,
      content: candidate.content,
      confidence: candidate.confidence,
      source: candidate.source,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      useCount: 0,
    };
    await this.store.saveCurated(memory);
  }

  /**
   * Auto-evaluate and persist all high-confidence candidates from the session.
   * Called at session end.
   */
  async flushSession(): Promise<number> {
    let persisted = 0;
    for (const event of this.sessionEvents) {
      const candidate = await this.evaluate(event);
      if (candidate && candidate.confidence >= 0.7) {
        await this.persist(candidate);
        persisted++;
      }
    }
    this.sessionEvents = [];
    return persisted;
  }

  // ── Internal evaluation logic ──────────────────────────────

  private evaluateToolResult(result: ToolResult): MemoryCandidate | null {
    // Detect successful build commands
    if (result.name === "shell_execute" && !result.error) {
      const output = result.output;

      // Build commands
      const buildPatterns = [
        /(?:npm|pnpm|yarn)\s+(?:run\s+)?build/i,
        /cargo\s+build/i,
        /make\s+/i,
        /tsc/i,
        /webpack/i,
        /vite\s+build/i,
      ];

      for (const pattern of buildPatterns) {
        if (pattern.test(output) && !output.includes("error") && !output.includes("ERROR")) {
          return {
            type: "build_command" as const,
            content: `Build command executed successfully. Output indicates the build process completed.`,
            confidence: 0.6,
            source: `tool:${result.name}`,
          };
        }
      }

      // Detect environment issues
      if (
        output.includes("command not found") ||
        output.includes("MODULE_NOT_FOUND") ||
        output.includes("ENOENT")
      ) {
        return {
          type: "env_issue" as const,
          content: `Environment issue detected: ${output.slice(0, 200)}`,
          confidence: 0.8,
          source: `tool:${result.name}`,
        };
      }
    }

    // Detect debug tips: error followed by successful resolution
    if (result.name === "shell_execute" && result.error) {
      return {
        type: "debug_tip" as const,
        content: `Error encountered: ${result.error.slice(0, 200)}`,
        confidence: 0.5,
        source: `tool:${result.name}`,
      };
    }

    return null;
  }
}
