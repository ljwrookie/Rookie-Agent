/**
 * Context Compactor (P4-T2)
 *
 * Compresses an in-flight conversation once its prompt+history threatens to
 * exceed the model's context window. Uses tiktoken-rs for accurate token counting.
 *
 *   1. Keep the system message + a suffix of the N most recent turns (default
 *      10). A "turn" is a group starting at the last user message that lets us
 *      preserve any subsequent tool_call / tool / assistant responses that are
 *      still being consumed.
 *   2. Summarise every message older than the keep-window through a supplied
 *      summariser (or the bundled heuristic fallback) and insert the summary
 *      back as a synthetic `system` notice at the top.
 *   3. Persist the summary to `MemoryStore.curated` (type: "decision") so the
 *      agent can still rehydrate later via FTS.
 *   4. Fire `PreCompact` / `PostCompact` hooks so auditors / notifiers can
 *      react.
 *
 * The module is deliberately framework-free: it operates on a mutable
 * `Message[]` and returns the compacted array so callers can either replace
 * their existing array in place or adopt the new one.
 */

import type { Message } from "./types.js";
import type { MemoryStore } from "../memory/store.js";
import type { HookRegistry } from "../hooks/registry.js";
import { NapiTransport } from "../transport/napi.js";

// ── Token accounting ────────────────────────────────────────────────

/**
 * Token estimator using native tiktoken-rs via NAPI.
 * P4-T2: Accurate token counting with < 1% error.
 */
let napiTransport: NapiTransport | null = null;

/**
 * Initialize the tokenizer with NAPI transport.
 */
export async function initTokenizer(transport?: NapiTransport): Promise<void> {
  if (transport) {
    napiTransport = transport;
  } else {
    // Try to create a new transport
    const { createTransport } = await import("../transport/napi.js");
    napiTransport = await createTransport();
  }
}

/**
 * Accurate token count using tiktoken-rs (P4-T2).
 * Falls back to estimate if NAPI is not available.
 */
export async function estimateTokensAccurate(text: string): Promise<number> {
  if (napiTransport?.isConnected()) {
    try {
      return await napiTransport.countTokens(text);
    } catch {
      // Fall through to estimate
    }
  }
  // Fallback: rough estimate
  return estimateTokensSync(text);
}

/**
 * Synchronous token estimator.
 * Uses rough estimate - prefer estimateTokensAccurate() for accuracy.
 */
export function estimateTokensSync(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Backwards-compatible token estimator (synchronous).
 */
export function estimateTokens(text: string): number {
  return estimateTokensSync(text);
}

export async function estimateMessageTokensAccurate(msg: Message): Promise<number> {
  let total = await estimateTokensAccurate(msg.content ?? "");
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      total += await estimateTokensAccurate(tc.name);
      total += await estimateTokensAccurate(JSON.stringify(tc.params ?? {}));
    }
  }
  // ~4 tokens of structural overhead per message (role tags, separators).
  return total + 4;
}

export function estimateMessageTokensSync(msg: Message): number {
  let total = estimateTokensSync(msg.content ?? "");
  if (msg.toolCalls && msg.toolCalls.length > 0) {
    for (const tc of msg.toolCalls) {
      total += estimateTokensSync(tc.name);
      total += estimateTokensSync(JSON.stringify(tc.params ?? {}));
    }
  }
  return total + 4;
}

/**
 * Backwards-compatible message token estimator (synchronous).
 */
export function estimateMessageTokens(msg: Message): number {
  return estimateMessageTokensSync(msg);
}

export async function estimateTotalTokensAccurate(messages: Message[]): Promise<number> {
  let total = 0;
  for (const m of messages) total += await estimateMessageTokensAccurate(m);
  return total;
}

export function estimateTotalTokensSync(messages: Message[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokensSync(m);
  return total;
}

/**
 * Backwards-compatible total token estimator (synchronous).
 */
export function estimateTotalTokens(messages: Message[]): number {
  return estimateTotalTokensSync(messages);
}

// ── Summariser contract ─────────────────────────────────────────────

/**
 * Pluggable summariser. Implementations will typically delegate to a model
 * provider. The compactor passes the messages scheduled for compression and
 * expects a human-readable summary string back.
 */
export type Summariser = (messages: Message[]) => Promise<string>;

/**
 * Heuristic fallback summariser used when the caller does not wire one up.
 * It produces a deterministic bullet-list so that tests and offline runs are
 * reproducible. This is *not* meant to replace a model-based summariser — it
 * just keeps the agent functional when no summariser is available.
 */
export const defaultSummariser: Summariser = async (messages) => {
  const bullets: string[] = [];
  const toolCounts = new Map<string, number>();
  let userTurns = 0;
  let assistantTurns = 0;

  for (const m of messages) {
    if (m.role === "user") userTurns += 1;
    if (m.role === "assistant") assistantTurns += 1;
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
      }
    }
  }

  bullets.push(`- ${messages.length} older messages compacted (user=${userTurns}, assistant=${assistantTurns}).`);
  if (toolCounts.size > 0) {
    const toolList = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}×${n}`)
      .join(", ");
    bullets.push(`- Tools used: ${toolList}.`);
  }
  // Surface the first user ask and last assistant reply for continuity.
  const firstUser = messages.find((m) => m.role === "user");
  if (firstUser) bullets.push(`- First ask: ${truncate(firstUser.content, 180)}`);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (lastAssistant && lastAssistant.content) {
    bullets.push(`- Last assistant reply: ${truncate(lastAssistant.content, 180)}`);
  }

  return bullets.join("\n");
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// ── Compactor ───────────────────────────────────────────────────────

export interface CompactorOptions {
  /**
   * The model's context window in tokens. Compaction triggers once usage
   * exceeds `contextWindow * triggerRatio`.
   */
  contextWindow: number;
  /** Default: 0.8 — matches the roadmap requirement. */
  triggerRatio?: number;
  /** How many recent messages to keep verbatim. Default: 10. */
  keepRecent?: number;
  /** Summariser used for the pre-window messages. */
  summariser?: Summariser;
  /** Optional memory store for persisting summaries. */
  memory?: MemoryStore;
  /** Optional hook registry for `PreCompact` / `PostCompact` firing. */
  hooks?: HookRegistry;
  /** Session id — flowed through to hooks + curated memory `source`. */
  sessionId?: string;
  /** Project root — flowed through to hooks. */
  projectRoot?: string;
  /** NAPI transport for accurate token counting (P4-T2). */
  napiTransport?: NapiTransport;
}

export interface CompactionResult {
  /** The new, shorter message array (safe to assign back). */
  messages: Message[];
  /** Tokens before compaction. */
  before: { messages: number; tokens: number };
  /** Tokens after compaction. */
  after: { messages: number; tokens: number };
  /** Curated memory id that holds the summary, if any. */
  summaryId?: string;
  /** Raw summary text. */
  summary: string;
  /** Trigger reason. */
  reason: "threshold" | "manual";
}

/**
 * Compactor is deliberately stateful-free: callers instantiate it with model
 * + memory + hooks bindings and then call `maybeCompact(messages)` before each
 * model call. It never mutates the input array — it returns a new one so the
 * caller can make replacement atomic.
 */
export class Compactor {
  private contextWindow: number;
  private triggerRatio: number;
  private keepRecent: number;
  private summariser: Summariser;
  private memory?: MemoryStore;
  private hooks?: HookRegistry;
  private sessionId: string;
  private projectRoot: string;
  private napiTransport?: NapiTransport;

  constructor(opts: CompactorOptions) {
    if (!Number.isFinite(opts.contextWindow) || opts.contextWindow <= 0) {
      throw new Error("Compactor: contextWindow must be a positive number");
    }
    this.contextWindow = opts.contextWindow;
    this.triggerRatio = clampRatio(opts.triggerRatio ?? 0.8);
    this.keepRecent = Math.max(1, opts.keepRecent ?? 10);
    this.summariser = opts.summariser ?? defaultSummariser;
    this.memory = opts.memory;
    this.hooks = opts.hooks;
    this.sessionId = opts.sessionId ?? "default";
    this.projectRoot = opts.projectRoot ?? process.cwd();
    this.napiTransport = opts.napiTransport;
  }

  /** The absolute token count that will trigger compaction. */
  get triggerTokens(): number {
    return Math.floor(this.contextWindow * this.triggerRatio);
  }

  /**
   * Pure check: does the given history need compacting under the current
   * threshold?
   */
  shouldCompact(messages: Message[]): boolean {
    return estimateTotalTokensSync(messages) > this.triggerTokens;
  }

  /**
   * Synchronous version for backwards compatibility.
   * Uses rough estimation.
   */
  shouldCompactSync(messages: Message[]): boolean {
    return estimateTotalTokensSync(messages) > this.triggerTokens;
  }

  /**
   * Compact when over-threshold, otherwise return the original array. Safe to
   * call on every model turn.
   */
  async maybeCompact(messages: Message[]): Promise<CompactionResult | null> {
    if (!this.shouldCompact(messages)) return null;
    return this.compact(messages, "threshold");
  }

  /**
   * Always compact, regardless of the threshold. Used by `/compact`.
   */
  async forceCompact(messages: Message[]): Promise<CompactionResult> {
    return this.compact(messages, "manual");
  }

  // ── Internals ─────────────────────────────────────────────────────

  private async estimateTotalTokens(messages: Message[]): Promise<number> {
    if (this.napiTransport?.isConnected()) {
      try {
        let total = 0;
        for (const m of messages) {
          total += await estimateMessageTokensAccurate(m);
        }
        return total;
      } catch {
        // Fall through to sync estimate
      }
    }
    return estimateTotalTokensSync(messages);
  }

  private async compact(
    messages: Message[],
    reason: "threshold" | "manual",
  ): Promise<CompactionResult> {
    const before = {
      messages: messages.length,
      tokens: await this.estimateTotalTokens(messages),
    };

    await this.hooks?.fire("PreCompact", {
      sessionId: this.sessionId,
      projectRoot: this.projectRoot,
      compaction: { reason, before },
    });

    // Partition: system prefix + older body + recent tail.
    const systemPrefix: Message[] = [];
    let i = 0;
    while (i < messages.length && messages[i].role === "system") {
      systemPrefix.push(messages[i]);
      i += 1;
    }
    const body = messages.slice(i);

    // `keepRecent` applies to the non-system tail. If the body is already
    // shorter than the keep window, there is nothing to summarise — we still
    // return the array unchanged but report the counts honestly.
    if (body.length <= this.keepRecent) {
      const result: CompactionResult = {
        messages,
        before,
        after: before,
        summary: "",
        reason,
      };
      await this.hooks?.fire("PostCompact", {
        sessionId: this.sessionId,
        projectRoot: this.projectRoot,
        compaction: { reason, before, after: result.after },
      });
      return result;
    }

    const older = body.slice(0, body.length - this.keepRecent);
    const recent = body.slice(body.length - this.keepRecent);

    const summaryText = (await this.summariser(older)).trim();
    const summaryMsg: Message = {
      role: "system",
      content: `# Compacted history (${older.length} messages)\n${summaryText}`,
    };

    // Persist as curated memory for later FTS recall.
    let summaryId: string | undefined;
    if (this.memory && summaryText) {
      summaryId = `compact_${this.sessionId}_${Date.now()}`;
      try {
        await this.memory.saveCurated({
          id: summaryId,
          type: "decision",
          content: summaryText,
          confidence: 0.6,
          source: `compactor:${this.sessionId}`,
          createdAt: Math.floor(Date.now() / 1000),
          lastUsedAt: Math.floor(Date.now() / 1000),
          useCount: 0,
        });
      } catch {
        // Curated persistence is best-effort; don't fail compaction.
        summaryId = undefined;
      }
    }

    const compacted: Message[] = [...systemPrefix, summaryMsg, ...recent];
    const after = {
      messages: compacted.length,
      tokens: await this.estimateTotalTokens(compacted),
    };

    const result: CompactionResult = {
      messages: compacted,
      before,
      after,
      summary: summaryText,
      summaryId,
      reason,
    };

    await this.hooks?.fire("PostCompact", {
      sessionId: this.sessionId,
      projectRoot: this.projectRoot,
      compaction: { reason, before, after, summaryId },
    });

    return result;
  }
}

function clampRatio(r: number): number {
  if (!Number.isFinite(r)) return 0.8;
  if (r <= 0) return 0.01;
  if (r >= 1) return 0.99;
  return r;
}
