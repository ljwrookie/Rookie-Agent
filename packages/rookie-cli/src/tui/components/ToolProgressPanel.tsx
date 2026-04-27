// ─── Tool Progress Panel ─────────────────────────────────────────
// A2: Real-time tool execution progress with live output streaming
// Shows: tool name, progress bar, elapsed time, live output

import React from "react";
import { Box, Text } from "ink";
import { COLORS } from "../types.js";

export interface ToolProgress {
  id: string;
  toolName: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number; // 0-100
  elapsedMs: number;
  output?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

interface ToolProgressPanelProps {
  tools: ToolProgress[];
  maxHeight?: number;
  compact?: boolean;
}

export function ToolProgressPanel({ tools, maxHeight = 10, compact = false }: ToolProgressPanelProps) {
  const activeTools = tools.filter(t => t.status === "running" || t.status === "pending");
  const completedTools = tools.filter(t => t.status === "completed" || t.status === "failed" || t.status === "cancelled");

  if (tools.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={COLORS.textDim}>No active tool executions</Text>
      </Box>
    );
  }

  if (compact) {
    return (
      <CompactProgressView
        activeTools={activeTools}
        completedTools={completedTools}
        maxHeight={maxHeight}
      />
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {/* Active tools section */}
      {activeTools.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={COLORS.system}>
            Active ({activeTools.length})
          </Text>
          {activeTools.map(tool => (
            <ActiveToolRow key={tool.id} tool={tool} />
          ))}
        </Box>
      )}

      {/* Completed tools section */}
      {completedTools.length > 0 && (
        <Box flexDirection="column">
          <Text bold color={COLORS.textDim}>
            Completed ({completedTools.length})
          </Text>
          {completedTools.slice(-3).map(tool => (
            <CompletedToolRow key={tool.id} tool={tool} />
          ))}
        </Box>
      )}
    </Box>
  );
}

// Compact view for status bar integration
function CompactProgressView({
  activeTools,
  completedTools,
  maxHeight,
}: {
  activeTools: ToolProgress[];
  completedTools: ToolProgress[];
  maxHeight: number;
}) {
  const runningCount = activeTools.filter(t => t.status === "running").length;
  const pendingCount = activeTools.filter(t => t.status === "pending").length;
  const failedCount = completedTools.filter(t => t.status === "failed").length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        {runningCount > 0 && (
          <Text color={COLORS.warning}>
            ⟳ {runningCount} running
          </Text>
        )}
        {pendingCount > 0 && (
          <>
            <Text color={COLORS.textDim}> │ </Text>
            <Text color={COLORS.textDim}>
              ⏳ {pendingCount} pending
            </Text>
          </>
        )}
        {failedCount > 0 && (
          <>
            <Text color={COLORS.textDim}> │ </Text>
            <Text color={COLORS.error}>
              ✗ {failedCount} failed
            </Text>
          </>
        )}
      </Box>

      {/* Progress bars for running tools */}
      <Box flexDirection="column" marginTop={1}>
        {activeTools.slice(0, maxHeight - 1).map(tool => (
          <CompactToolProgress key={tool.id} tool={tool} />
        ))}
      </Box>
    </Box>
  );
}

function ActiveToolRow({ tool }: { tool: ToolProgress }) {
  const elapsed = formatDuration(tool.elapsedMs);
  const progressBar = renderProgressBar(tool.progress, 20);

  return (
    <Box flexDirection="column" marginY={1}>
      <Box justifyContent="space-between">
        <Box>
          <Text color={getStatusColor(tool.status)}>
            {getStatusIcon(tool.status)}
          </Text>
          <Text> </Text>
          <Text bold color={COLORS.text}>
            {tool.toolName}
          </Text>
        </Box>
        <Text color={COLORS.textDim}>{elapsed}</Text>
      </Box>

      {/* Progress bar */}
      <Box>
        <Text color={COLORS.progressBar}>{progressBar}</Text>
        <Text color={COLORS.textDim}> {tool.progress}%</Text>
      </Box>

      {/* Live output preview */}
      {tool.output && (
        <Box marginLeft={2} marginTop={1}>
          <Text color={COLORS.textDim} wrap="truncate-end">
            {tool.output.split("\n").pop()?.slice(0, 60)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function CompletedToolRow({ tool }: { tool: ToolProgress }) {
  const elapsed = tool.endTime
    ? formatDuration(tool.endTime - tool.startTime)
    : formatDuration(tool.elapsedMs);

  return (
    <Box justifyContent="space-between" marginY={1}>
      <Box>
        <Text color={getStatusColor(tool.status)}>
          {getStatusIcon(tool.status)}
        </Text>
        <Text> </Text>
        <Text color={COLORS.text}>{tool.toolName}</Text>
      </Box>
      <Box>
        {tool.error && (
          <Text color={COLORS.error} wrap="truncate-end">
            {tool.error.slice(0, 30)}
          </Text>
        )}
        <Text color={COLORS.textDim}> {elapsed}</Text>
      </Box>
    </Box>
  );
}

function CompactToolProgress({ tool }: { tool: ToolProgress }) {
  const progressBar = renderProgressBar(tool.progress, 15);

  return (
    <Box>
      <Text color={COLORS.textDim}>{tool.toolName.slice(0, 15)}:</Text>
      <Text> </Text>
      <Text color={COLORS.progressBar}>{progressBar}</Text>
      <Text color={COLORS.textDim}> {tool.progress}%</Text>
    </Box>
  );
}

// Helper functions
function getStatusIcon(status: ToolProgress["status"]): string {
  switch (status) {
    case "pending": return "⏳";
    case "running": return "⟳";
    case "completed": return "✓";
    case "failed": return "✗";
    case "cancelled": return "⊘";
    default: return "?";
  }
}

function getStatusColor(status: ToolProgress["status"]): string {
  switch (status) {
    case "pending": return COLORS.textDim;
    case "running": return COLORS.warning;
    case "completed": return COLORS.success;
    case "failed": return COLORS.error;
    case "cancelled": return COLORS.textDim;
    default: return COLORS.text;
  }
}

function renderProgressBar(progress: number, width: number): string {
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

// Hook for tracking tool progress
export function useToolProgress() {
  const [tools, setTools] = React.useState<ToolProgress[]>([]);

  const startTool = React.useCallback((id: string, toolName: string) => {
    setTools(prev => {
      if (prev.find(t => t.id === id)) return prev;
      return [...prev, {
        id,
        toolName,
        status: "running",
        progress: 0,
        elapsedMs: 0,
        startTime: Date.now(),
      }];
    });
  }, []);

  const updateTool = React.useCallback((id: string, updates: Partial<ToolProgress>) => {
    setTools(prev => prev.map(t =>
      t.id === id ? { ...t, ...updates } : t
    ));
  }, []);

  const completeTool = React.useCallback((id: string, success: boolean, output?: string, error?: string) => {
    setTools(prev => prev.map(t =>
      t.id === id
        ? {
            ...t,
            status: success ? "completed" : "failed",
            progress: success ? 100 : t.progress,
            endTime: Date.now(),
            output,
            error,
          }
        : t
    ));
  }, []);

  const cancelTool = React.useCallback((id: string) => {
    setTools(prev => prev.map(t =>
      t.id === id
        ? { ...t, status: "cancelled", endTime: Date.now() }
        : t
    ));
  }, []);

  const clearCompleted = React.useCallback(() => {
    setTools(prev => prev.filter(t =>
      t.status === "running" || t.status === "pending"
    ));
  }, []);

  // Update elapsed time for running tools
  React.useEffect(() => {
    const interval = setInterval(() => {
      setTools(prev => prev.map(t => {
        if (t.status === "running") {
          return {
            ...t,
            elapsedMs: Date.now() - t.startTime,
          };
        }
        return t;
      }));
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return {
    tools,
    startTool,
    updateTool,
    completeTool,
    cancelTool,
    clearCompleted,
  };
}
