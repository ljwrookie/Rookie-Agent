// ─── Log Panel ───────────────────────────────────────────────────
// Shows terminal output, debug logs, error details
// Default collapsed in sidebar; full view in logs mode

import { Box, Text } from "ink";
import type { StreamEvent, StructuredError, LongTask } from "../types.js";
import { COLORS } from "../types.js";

interface LogPanelProps {
  events: StreamEvent[];
  errors: StructuredError[];
  longTasks: LongTask[];
  maxHeight: number;
  scrollOffset: number;
}

export function LogPanel({ events, errors, longTasks, maxHeight, scrollOffset }: LogPanelProps) {
  // Merge all log-worthy items into a timeline
  const logItems: LogItem[] = [];

  // Tool results with output
  for (const ev of events) {
    if (ev.type === "action" && ev.detail) {
      logItems.push({
        timestamp: ev.timestamp,
        type: "tool",
        title: ev.title,
        content: ev.detail,
        severity: ev.severity === "success" ? "info" : ev.severity as "info" | "warning" | "error",
      });
    }
  }

  // Errors
  for (const err of errors) {
    logItems.push({
      timestamp: err.timestamp,
      type: "error",
      title: err.title,
      content: [
        err.cause ? `Cause: ${err.cause}` : null,
        err.suggestion ? `Suggestion: ${err.suggestion}` : null,
        err.raw ? `Raw: ${err.raw}` : null,
      ].filter(Boolean).join("\n"),
      severity: err.severity === "fatal" ? "error" : err.severity,
    });
  }

  // Long task output
  for (const task of longTasks) {
    if (task.output) {
      logItems.push({
        timestamp: task.startedAt,
        type: "task",
        title: `[${task.name}] ${task.phase}`,
        content: task.output,
        severity: task.status === "error" ? "error" : "info",
      });
    }
  }

  // Sort by timestamp
  logItems.sort((a, b) => a.timestamp - b.timestamp);

  if (logItems.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={COLORS.textDim}>No logs yet.</Text>
      </Box>
    );
  }

  // Flatten to lines for scrollable display
  const lines: { color: string; text: string }[] = [];
  for (const item of logItems) {
    const time = fmtTime(item.timestamp);
    const badge = item.type === "error" ? "ERR" : item.type === "task" ? "TASK" : "LOG";
    const color = item.severity === "error" ? COLORS.error :
                  item.severity === "warning" ? COLORS.warning : COLORS.textDim;

    lines.push({ color, text: `${time} [${badge}] ${item.title}` });
    if (item.content) {
      for (const line of item.content.split("\n").slice(0, 20)) {
        lines.push({ color: COLORS.textDim, text: `  ${line}` });
      }
    }
  }

  const visible = lines.slice(scrollOffset, scrollOffset + maxHeight);

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {visible.map((line, i) => (
        <Text key={scrollOffset + i} color={line.color} wrap="truncate-end">
          {line.text}
        </Text>
      ))}
      {scrollOffset + maxHeight < lines.length && (
        <Text color={COLORS.textDim}>
          ↓ {lines.length - scrollOffset - maxHeight} more (j/k to scroll)
        </Text>
      )}
    </Box>
  );
}

interface LogItem {
  timestamp: number;
  type: "tool" | "error" | "task";
  title: string;
  content: string;
  severity: "info" | "warning" | "error";
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}
