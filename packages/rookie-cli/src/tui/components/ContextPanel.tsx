// ─── Context Panel ───────────────────────────────────────────────
// Sidebar showing: working directory, git info, recent/active files, tasks

import { Box, Text } from "ink";
import type { WorkspaceContext, LongTask, AgentStatus } from "../types.js";
import { useTheme } from "../hooks/useTheme.js";

interface ContextPanelProps {
  context: WorkspaceContext;
  longTasks: LongTask[];
  model: string;
  sessionAge: string;
  maxHeight: number;
  tab?: "context" | "files" | "agents" | "commands";
  commands?: Array<{ name: string; description: string; usage?: string; category?: string }>;
  agents?: AgentStatus[];
}

export function ContextPanel({ context, longTasks, model, sessionAge, tab = "context", commands = [], agents = [] }: ContextPanelProps) {
  const { theme } = useTheme();
  const runningTasks = longTasks.filter(t => t.status === "running");

  if (tab === "files") {
    return (
      <Box flexDirection="column" overflow="hidden">
        <Section title={`ACTIVE (${context.activeFiles.length})`}>
          {context.activeFiles.length === 0 ? (
            <Text color={theme.colors.textDim}>-</Text>
          ) : (
            context.activeFiles.slice(-12).reverse().map(f => (
              <Text key={f} color={theme.colors.text} wrap="truncate-end">· {shortPath(f)}</Text>
            ))
          )}
        </Section>
        <Section title={`RECENT (${context.recentFiles.length})`}>
          {context.recentFiles.length === 0 ? (
            <Text color={theme.colors.textDim}>-</Text>
          ) : (
            context.recentFiles.slice(-12).reverse().map(f => (
              <Text key={f} color={theme.colors.textDim} wrap="truncate-end">· {shortPath(f)}</Text>
            ))
          )}
        </Section>
        <Text color={theme.colors.textDim}>Tip: Tab/Esc 退出输入后可用 g/b 导航</Text>
      </Box>
    );
  }

  if (tab === "commands") {
    const items = commands.slice(0, 18);
    return (
      <Box flexDirection="column" overflow="hidden">
        <Section title={`COMMANDS (${commands.length})`}>
          {items.length === 0 ? (
            <Text color={theme.colors.textDim}>-</Text>
          ) : (
            items.map((c) => (
              <Box key={c.name} flexDirection="column" marginBottom={1}>
                <Text color={theme.colors.text} wrap="truncate-end">/{c.name}</Text>
                {c.description && <Text color={theme.colors.textDim} wrap="truncate-end">{c.description}</Text>}
                {c.usage && <Text color={theme.colors.textDim} wrap="truncate-end">{c.usage}</Text>}
              </Box>
            ))
          )}
          {commands.length > items.length && (
            <Text color={theme.colors.textDim}>+{commands.length - items.length} more…</Text>
          )}
        </Section>
        <Text color={theme.colors.textDim}>Tip: 输入 “/” 查看建议，Tab 自动补全</Text>
      </Box>
    );
  }

  if (tab === "agents") {
    return (
      <Box flexDirection="column" overflow="hidden">
        <Section title={`AGENTS (${agents.length})`}>
          {agents.length === 0 ? (
            <Text color={theme.colors.textDim}>-</Text>
          ) : (
            agents.slice(0, 16).map((a) => (
              <Box key={a.id} justifyContent="space-between">
                <Text color={theme.colors.text} wrap="truncate-end">{a.name}</Text>
                <Text color={a.state === "running" ? theme.colors.warning : a.state === "error" ? theme.colors.error : a.state === "done" ? theme.colors.success : theme.colors.textDim}>
                  {a.state}
                </Text>
              </Box>
            ))
          )}
        </Section>
        <Text color={theme.colors.textDim}>Tip: g a 打开 Agent 面板</Text>
      </Box>
    );
  }

  // Default: context
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
          <Text color={theme.colors.textDim}>-</Text>
        ) : (
          context.activeFiles.slice(-8).map(f => (
            <Text key={f} color={theme.colors.text} wrap="truncate-end">
              · {shortPath(f)}
            </Text>
          ))
        )}
        {context.activeFiles.length > 8 && (
          <Text color={theme.colors.textDim}>+{context.activeFiles.length - 8} more</Text>
        )}
      </Section>

      {/* Tasks */}
      <Section title="TASKS">
        <Row label="Done" value={`${context.taskCount.done}/${context.taskCount.total}`} />
        {context.taskCount.pending > 0 && (
          <Row label="Pending" value={String(context.taskCount.pending)} valueColor={theme.colors.warning} />
        )}
      </Section>

      {/* Running background tasks with progress */}
      {runningTasks.length > 0 && (
        <Section title="BACKGROUND">
          {runningTasks.map(t => (
            <Box key={t.id} flexDirection="column" marginBottom={1}>
              <Box justifyContent="space-between">
                <Text color={theme.colors.warning} wrap="truncate-end">
                  ⟳ {t.name}
                </Text>
                <Text color={theme.colors.textDim}>
                  {fmtDuration(Date.now() - t.startedAt)}
                </Text>
              </Box>
              {/* A2: Tool execution progress bar */}
              {t.progress !== undefined && (
                <Box marginTop={0}>
                  <ProgressBar progress={t.progress} width={20} />
                  <Text color={theme.colors.textDim} dimColor> {Math.round(t.progress * 100)}%</Text>
                </Box>
              )}
              {t.output && (
                <Text color={theme.colors.textDim} wrap="truncate-end">
                  {t.output.slice(-40)}
                </Text>
              )}
            </Box>
          ))}
        </Section>
      )}

    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { theme } = useTheme();
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={theme.colors.textDim} bold>{title}</Text>
      {children}
    </Box>
  );
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const { theme } = useTheme();
  return (
    <Box justifyContent="space-between">
      <Text color={theme.colors.textDim}>{label}</Text>
      <Text color={valueColor ?? theme.colors.text} wrap="truncate-end">{value}</Text>
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
  const { theme } = useTheme();
  const filled = Math.max(0, Math.min(width, Math.round(progress * width)));
  const empty = width - filled;
  return (
    <Box>
      <Text color={theme.colors.progressBar}>
        {"█".repeat(filled)}
      </Text>
      <Text color={theme.colors.progressTrack}>
        {"░".repeat(empty)}
      </Text>
    </Box>
  );
}
