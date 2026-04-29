// ─── Context Preprocessing Pipeline ──────────────────────────────
// P4-T3: 5-stage context compression pipeline with Rust backend

import type { Message } from "./types.js";
import { NapiTransport } from "../transport/napi.js";

// ─── Pipeline Configuration ──────────────────────────────────────

export interface PipelineConfig {
  maxToolResultTokens?: number; // Stage 1: tool result budget
  snipThreshold?: number; // Stage 2: snip threshold
  maxMessages?: number; // Stage 4: context collapse threshold
  compactThreshold?: number; // Stage 5: auto-compact threshold
  contextWindow?: number; // Context window size
  useNative?: boolean; // Use Rust native implementation
}

export interface PipelineResult {
  messages: Message[];
  stats: {
    stage1ToolResults: number;
    stage2Snipped: number;
    stage3Normalized: number;
    stage4Collapsed: number;
    stage5Compacted: number;
    totalTokensBefore: number;
    totalTokensAfter: number;
  };
}

// ─── NAPI Transport Instance ─────────────────────────────────────

let napiTransport: NapiTransport | null = null;

/**
 * Initialize the context pipeline with NAPI transport.
 * P4-T3: Uses Rust native implementation when available.
 */
export async function initContextPipeline(transport?: NapiTransport): Promise<void> {
  if (transport) {
    napiTransport = transport;
  } else {
    const { createTransport } = await import("../transport/napi.js");
    napiTransport = await createTransport();
  }
}

// ─── Main Pipeline Function ──────────────────────────────────────

/**
 * Run the 5-stage context pipeline.
 * P4-T3: Delegates to Rust native implementation when available.
 */
export async function runContextPipeline(
  messages: Message[],
  config: PipelineConfig = {}
): Promise<PipelineResult> {
  // Try native implementation first
  if (config.useNative !== false && napiTransport?.isConnected()) {
    try {
      return await runNativePipeline(messages, config);
    } catch {
      // Fall through to JS implementation
    }
  }

  // JS fallback implementation
  return runJSPipeline(messages, config);
}

/**
 * Run pipeline using Rust native implementation.
 */
async function runNativePipeline(
  messages: Message[],
  config: PipelineConfig
): Promise<PipelineResult> {
  if (!napiTransport) {
    throw new Error("NAPI transport not initialized");
  }

  const result = await napiTransport.runContextPipeline(messages, {
    maxToolResultTokens: config.maxToolResultTokens,
    snipThreshold: config.snipThreshold,
    maxMessages: config.maxMessages,
    compactThreshold: config.compactThreshold,
    contextWindow: config.contextWindow,
  });

  return {
    messages: result.messages,
    stats: {
      stage1ToolResults: result.stats.stage1ToolResults,
      stage2Snipped: result.stats.stage2Snipped,
      stage3Normalized: result.stats.stage3Normalized,
      stage4Collapsed: result.stats.stage4Collapsed,
      stage5Compacted: result.stats.stage5Compacted,
      totalTokensBefore: result.stats.totalTokensBefore,
      totalTokensAfter: result.stats.totalTokensAfter,
    },
  };
}

/**
 * JS fallback implementation of the 5-stage pipeline.
 */
function runJSPipeline(messages: Message[], config: PipelineConfig): PipelineResult {
  const stats = {
    stage1ToolResults: 0,
    stage2Snipped: 0,
    stage3Normalized: 0,
    stage4Collapsed: 0,
    stage5Compacted: 0,
    totalTokensBefore: estimateTokens(messages),
    totalTokensAfter: 0,
  };

  let result = [...messages];

  // Stage 1: Apply tool result budget
  result = applyToolResultBudget(result, config.maxToolResultTokens ?? 8000);
  stats.stage1ToolResults = countAffected(result, "tool_result_budget");

  // Stage 2: Snip compact - truncate long messages
  result = snipCompact(result, config.snipThreshold ?? 4000);
  stats.stage2Snipped = countAffected(result, "snipped");

  // Stage 3: Microcompact - normalize whitespace
  result = microcompact(result);
  stats.stage3Normalized = countAffected(result, "normalized");

  // Stage 4: Context collapse - fold old conversations
  result = contextCollapse(result, config.maxMessages ?? 50);
  stats.stage4Collapsed = countAffected(result, "collapsed");

  // Stage 5: Autocompact - final compression
  result = autocompact(result, config.compactThreshold ?? 0.8, config.contextWindow ?? 128000);
  stats.stage5Compacted = countAffected(result, "compacted");

  stats.totalTokensAfter = estimateTokens(result);

  return { messages: result, stats };
}

// ─── Pipeline Stages ─────────────────────────────────────────────

/** Stage 1: Apply tool result budget */
function applyToolResultBudget(messages: Message[], maxTokens: number): Message[] {
  return messages.map((msg) => {
    if (msg.role !== "tool") return msg;

    const content = msg.content || "";
    const estimatedTokens = Math.ceil(content.length / 4);

    if (estimatedTokens <= maxTokens) return msg;

    // Truncate and add indicator
    const truncateRatio = maxTokens / estimatedTokens;
    const truncatedLength = Math.floor(content.length * truncateRatio);
    const truncated = content.slice(0, truncatedLength);

    return {
      ...msg,
      content:
        truncated + `\n\n[... truncated: showing ${maxTokens} of ~${estimatedTokens} tokens ...]`,
      metadata: { ...msg.metadata, _pipeline: "tool_result_budget" },
    };
  });
}

/** Stage 2: Snip compact - truncate long messages */
function snipCompact(messages: Message[], threshold: number): Message[] {
  return messages.map((msg) => {
    const content = msg.content || "";
    const estimatedTokens = Math.ceil(content.length / 4);

    if (estimatedTokens <= threshold) return msg;

    // Keep beginning and end, snip middle
    const keepTokens = Math.floor(threshold * 0.8); // 40% front + 40% back
    const keepChars = keepTokens * 4;
    const frontChars = Math.floor(keepChars * 0.5);
    const backChars = Math.floor(keepChars * 0.5);

    const front = content.slice(0, frontChars);
    const back = content.slice(-backChars);
    const snipped = estimatedTokens - keepTokens;

    return {
      ...msg,
      content: `${front}\n\n[... ${snipped} tokens snipped ...]\n\n${back}`,
      metadata: { ...msg.metadata, _pipeline: "snipped" },
    };
  });
}

/** Stage 3: Microcompact - normalize whitespace */
function microcompact(messages: Message[]): Message[] {
  return messages.map((msg) => {
    let content = msg.content || "";

    // Remove consecutive empty lines (more than 2)
    content = content.replace(/\n{3,}/g, "\n\n");

    // Normalize indentation (convert tabs to 2 spaces)
    content = content.replace(/\t/g, "  ");

    // Trim trailing whitespace per line
    content = content
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n");

    // Check if changed
    const changed = content !== (msg.content || "");

    return {
      ...msg,
      content,
      metadata: changed ? { ...msg.metadata, _pipeline: "normalized" } : msg.metadata,
    };
  });
}

/** Stage 4: Context collapse - fold old conversations */
function contextCollapse(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages) return messages;

  // Keep system message
  const systemMsgs = messages.filter((m) => m.role === "system");

  // Keep recent messages
  const recentCount = maxMessages - systemMsgs.length - 1;
  const recentMsgs = messages.slice(-recentCount);

  // Collapse middle messages into summary
  const middleStart = systemMsgs.length;
  const middleEnd = messages.length - recentCount;
  const middleMsgs = messages.slice(middleStart, middleEnd);

  if (middleMsgs.length > 0) {
    const summary: Message = {
      role: "system",
      content: `[${middleMsgs.length} earlier messages collapsed]`,
      metadata: { _pipeline: "collapsed", _collapsedCount: middleMsgs.length },
    };

    return [...systemMsgs, summary, ...recentMsgs];
  }

  return messages;
}

/** Stage 5: Autocompact - final compression */
function autocompact(messages: Message[], threshold: number, contextWindow: number): Message[] {
  const estimatedTokens = estimateTokens(messages);

  if (estimatedTokens < contextWindow * threshold) return messages;

  // Need to compact - remove or summarize oldest non-system messages
  const systemMsgs = messages.filter((m) => m.role === "system");
  const otherMsgs = messages.filter((m) => m.role !== "system");

  // Keep half of other messages
  const keepCount = Math.max(10, Math.floor(otherMsgs.length / 2));
  const keptMsgs = otherMsgs.slice(-keepCount);

  const summary: Message = {
    role: "system",
    content: `[Autocompacted: ${otherMsgs.length - keepCount} older messages removed to fit context window]`,
    metadata: { _pipeline: "compacted", _removedCount: otherMsgs.length - keepCount },
  };

  return [...systemMsgs, summary, ...keptMsgs];
}

// ─── Helper Functions ────────────────────────────────────────────

/** Estimate tokens (rough approximation) */
function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    // Rough estimate: 1 token ≈ 4 chars for English text
    total += Math.ceil((msg.content || "").length / 4);
    // Add overhead per message
    total += 4;
  }
  return total;
}

/** Count messages affected by pipeline stage */
function countAffected(messages: Message[], stage: string): number {
  return messages.filter((m) => m.metadata?._pipeline === stage).length;
}

/** Log pipeline stats */
export function logPipelineStats(result: PipelineResult): void {
  const { stats } = result;
  console.log("Context Pipeline Stats:");
  console.log(`  Stage 1 (Tool Budget): ${stats.stage1ToolResults} messages affected`);
  console.log(`  Stage 2 (Snip): ${stats.stage2Snipped} messages affected`);
  console.log(`  Stage 3 (Normalize): ${stats.stage3Normalized} messages affected`);
  console.log(`  Stage 4 (Collapse): ${stats.stage4Collapsed} messages affected`);
  console.log(`  Stage 5 (Autocompact): ${stats.stage5Compacted} messages affected`);
  console.log(
    `  Total: ${stats.totalTokensBefore} → ${stats.totalTokensAfter} tokens (${Math.round(
      (stats.totalTokensAfter / stats.totalTokensBefore) * 100
    )}%)`
  );
}
