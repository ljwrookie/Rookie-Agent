// ─── Context Panel ───────────────────────────────────────────────
// Sidebar showing: working directory, git info, recent/active files, tasks

import { Box, Text } from "ink";
import type { WorkspaceContext, LongTask } from "../types.js";
import { COLORS } from "../types.js";

interface ContextPanelProps {
  context: WorkspaceContext;
  longTasks: LongTask[];
  model: string;
  sessionAge: string;
  maxHeight: number;
}

export function ContextPanel({ context, longTasks, model, sessionAge }: ContextPanelProps) {
  const runningTasks = longTasks.filter(t => t.status === "running");

  return (
    <Box flexDirection="column" overflow="hidden">
      {/* Session info */}
      <Section title="SESSION">
        <Row label="Model" value={model} />
        <Row label="Uptime" value={sessionAge} />
        <Row label="Dir" value={shortDir(context.directory)} />
        {context.gitBranch && (
          <Row label="Branch" value={context.gitBranch} valueColor={context.gitDirty ? "yellow" : "green"} />
        )}
      </Section>

      {/* Active files */}
      <Section title={`FILES (${context.activeFiles.length})`}>
        {context.activeFiles.length === 0 ? (
          <Text color={COLORS.textDim}>-</Text>
        ) : (
          context.activeFiles.slice(-8).map(f => (
            <Text key={f} color={COLORS.text} wrap="truncate-end">
              · {shortPath(f)}
            </Text>
          ))
        )}
        {context.activeFiles.length > 8 && (
          <Text color={COLORS.textDim}>+{context.activeFiles.length - 8} more</Text>
        )}
      </Section>

      {/* Tasks */}
      <Section title="TASKS">
        <Row label="Done" value={`${context.taskCount.done}/${context.taskCount.total}`} />
        {context.taskCount.pending > 0 && (
          <Row label="Pending" value={String(context.taskCount.pending)} valueColor={COLORS.warning} />
        )}
      </Section>

      {/* Running background tasks with progress */}
      {runningTasks.length > 0 && (
        <Section title="BACKGROUND">
          {runningTasks.map(t => (
            <Box key={t.id} flexDirection="column" marginBottom={1}>
              <Box justifyContent="space-between">
                <Text color={COLORS.warning} wrap="truncate-end">
                  ⟳ {t.name}
                </Text>
                <Text color={COLORS.textDim}>
                  {fmtDuration(Date.now() - t.startedAt)}
                </Text>
              </Box>
              {/* A2: Tool execution progress bar */}
              {t.progress !== undefined && (
                <Box marginTop={0}>
                  <ProgressBar progress={t.progress} width={20} />
                  <Text color={COLORS.textDim} dimColor> {Math.round(t.progress * 100)}%</Text>
                </Box>
              )}
              {t.output && (
                <Text color={COLORS.textDim} wrap="truncate-end">
                  {t.output.slice(-40)}
                </Text>
              )}
            </Box>
          ))}
        </Section>
      )}

      {/* Keyboard help (at bottom) */}
      <Box flexDirection="column" marginTop={1}>
        <Text color={COLORS.textDim} bold>KEYS</Text>
        <Text color={COLORS.textDim}>j/k scroll  d diff  l logs</Text>
        <Text color={COLORS.textDim}>a approve  r retry  / cmd</Text>
        <Text color={COLORS.textDim}>1-5 modes  Esc back  ^C quit</Text>
      </Box>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={COLORS.textDim} bold>{title}</Text>
      {children}
    </Box>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <Box justifyContent="space-between">
      <Text color={COLORS.textDim}>{label}</Text>
      <Text color={valueColor ?? COLORS.text} wrap="truncate-end">{value}</Text>
    </Box>
  );
}

function shortDir(dir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && dir.startsWith(home)) return "~" + dir.slice(home.length);
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 2) return dir;
  return ".../" + parts.slice(-2).join("/");
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return p;
  return parts.slice(-2).join("/");
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m${s % 60}s`;
}

// A2/A3: Progress bar component for tool execution with theming
function ProgressBar({ progress, width = 20 }: { progress: number; width?: number }) {
  const filled = Math.max(0, Math.min(width, Math.round(progress * width)));
  const empty = width - filled;
  return (
    <Box>
      <Text color={COLORS.progressBar}>
        {"█".repeat(filled)}
      </Text>
      <Text color={COLORS.progressTrack}>
        {"░".repeat(empty)}
      </Text>
    </Box>
  );
}
