// ─── Context Preprocessing Pipeline ──────────────────────────────
// B6: 5-stage context compression pipeline

import type { Message } from "./types.js";

// B6: Pipeline configuration
export interface PipelineConfig {
  maxToolResultTokens?: number;      // Stage 1: tool result budget
  snipThreshold?: number;            // Stage 2: snip threshold
  maxMessages?: number;              // Stage 4: context collapse threshold
  compactThreshold?: number;         // Stage 5: auto-compact threshold
}

// B6: Pipeline stage result
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

// B6: Main pipeline function
export function runContextPipeline(
  messages: Message[],
  config: PipelineConfig = {}
): PipelineResult {
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
  result = autocompact(result, config.compactThreshold ?? 0.8);
  stats.stage5Compacted = countAffected(result, "compacted");

  stats.totalTokensAfter = estimateTokens(result);

  return { messages: result, stats };
}

// B6: Stage 1 - Apply tool result budget
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
      content: truncated + `\n\n[... truncated: showing ${maxTokens} of ~${estimatedTokens} tokens ...]`,
      metadata: { ...msg.metadata, _pipeline: "tool_result_budget" },
    };
  });
}

// B6: Stage 2 - Snip compact
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

// B6: Stage 3 - Microcompact
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
      metadata: changed
        ? { ...msg.metadata, _pipeline: "normalized" }
        : msg.metadata,
    };
  });
}

// B6: Stage 4 - Context collapse
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

// B6: Stage 5 - Autocompact
function autocompact(messages: Message[], threshold: number): Message[] {
  const estimatedTokens = estimateTokens(messages);
  const maxTokens = 128000; // Assume 128k context window

  if (estimatedTokens < maxTokens * threshold) return messages;

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

// B6: Helper - estimate tokens
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

// B6: Helper - count messages affected by pipeline stage
function countAffected(messages: Message[], stage: string): number {
  return messages.filter((m) => m.metadata?._pipeline === stage).length;
}

// B6: Pipeline logger
export function logPipelineStats(result: PipelineResult): void {
  const { stats } = result;
  console.log("Context Pipeline Stats:");
  console.log(`  Stage 1 (Tool Budget): ${stats.stage1ToolResults} messages affected`);
  console.log(`  Stage 2 (Snip): ${stats.stage2Snipped} messages affected`);
  console.log(`  Stage 3 (Normalize): ${stats.stage3Normalized} messages affected`);
  console.log(`  Stage 4 (Collapse): ${stats.stage4Collapsed} messages affected`);
  console.log(`  Stage 5 (Autocompact): ${stats.stage5Compacted} messages affected`);
  console.log(`  Total: ${stats.totalTokensBefore} → ${stats.totalTokensAfter} tokens (${
    Math.round((stats.totalTokensAfter / stats.totalTokensBefore) * 100)
  }%)`);
}
