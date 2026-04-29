// ─── Top Status Bar ──────────────────────────────────────────────
// Shows: mode | model | directory | branch | context gauge | indicators

import { Box, Text } from "ink";
import type { StatusInfo, TuiMode } from "../types.js";
import { useTheme } from "../hooks/useTheme.js";

interface TopStatusBarProps {
  status: StatusInfo;
  mode: TuiMode;
  version?: string;
  isProcessing: boolean;
  // A4: Plan mode indicator
  isPlanMode?: boolean;
}

const MODE_LABELS: Record<TuiMode, string> = {
  chat: "CHAT",
  plan: "PLAN",
  diff: "DIFF",
  logs: "LOGS",
  review: "REVIEW",
  approve: "APPROVE",
  agents: "AGENTS",
  model: "MODEL",
  checkpoint: "UNDO",
  skill: "SKILL",
  memory: "MEM",
};

/** P3.2: Render a compact context usage gauge */
function ContextGauge({ ratio }: { ratio: number }) {
  const { theme } = useTheme();
  const pct = Math.round(ratio * 100);

  // Color thresholds: green <60%, yellow <85%, red >85%
  let color = theme.colors.success;
  if (ratio >= 0.85) color = theme.colors.error;
  else if (ratio >= 0.60) color = theme.colors.warning;

  // Compact bar: 8 segments
  const segments = 8;
  const filled = Math.round(ratio * segments);
  const bar = "█".repeat(filled) + "░".repeat(segments - filled);

  return (
    <Box>
      <Text color={theme.colors.textDim}>ctx </Text>
      <Text color={color} bold>{bar}</Text>
      <Text color={theme.colors.textDim}> {pct}%</Text>
      {ratio >= 0.90 && (
        <Text color={theme.colors.warning}> /compact</Text>
      )}
    </Box>
  );
}

export function TopStatusBar({ status, mode, version, isProcessing, isPlanMode }: TopStatusBarProps) {
  const { theme } = useTheme();
  const modeLabel = MODE_LABELS[mode];

  return (
    <Box paddingX={1} height={1} justifyContent="space-between">
      {/* Left: mode badge + plan badge + model + directory */}
      <Box>
        <Text backgroundColor="blueBright" color="black" bold>
          {` ${modeLabel} `}
        </Text>
        {/* A4: Plan mode badge */}
        {isPlanMode && (
          <>
            <Text> </Text>
            <Text backgroundColor="yellow" color="black" bold>
              {` [PLAN] `}
            </Text>
          </>
        )}
        <Text color={theme.colors.textDim}> </Text>
        <Text color={theme.colors.system} bold>
          {status.model}
        </Text>
        <Text color={theme.colors.textDim}> │ </Text>
        <Text color={theme.colors.text}>
          {shortDir(status.directory)}
        </Text>
        {status.branch && (
          <>
            <Text color={theme.colors.textDim}> ⎇ </Text>
            <Text color="yellow">{status.branch}</Text>
          </>
        )}
      </Box>

      {/* Center: context gauge (P3.2) */}
      {typeof status.contextRatio === "number" && (
        <Box>
          <ContextGauge ratio={status.contextRatio} />
        </Box>
      )}

      {/* Right: indicators */}
      <Box>
        {status.pendingApprovals > 0 && (
          <>
            <Text color={theme.colors.warning} bold>
              ⚠ {status.pendingApprovals} pending
            </Text>
            <Text color={theme.colors.textDim}> │ </Text>
          </>
        )}
        {status.backgroundProcesses > 0 && (
          <>
            <Text color={theme.colors.system}>
              ⟳ {status.backgroundProcesses} bg
            </Text>
            <Text color={theme.colors.textDim}> │ </Text>
          </>
        )}
        <Text color={isProcessing ? theme.colors.warning : theme.colors.success}>
          {isProcessing ? "● Running" : "○ Ready"}
        </Text>
        <Text color={theme.colors.textDim}> │ </Text>
        <Text color={theme.colors.textDim}>
          {version ? `v${version}` : "dev"}
        </Text>
      </Box>
    </Box>
  );
}

function shortDir(dir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && dir.startsWith(home)) {
    return "~" + dir.slice(home.length);
  }
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 3) return dir;
  return ".../" + parts.slice(-2).join("/");
}
