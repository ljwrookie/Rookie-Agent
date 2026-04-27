// ─── Top Status Bar ──────────────────────────────────────────────
// Shows: model | directory | branch | permissions | task status | bg processes | pending approvals

import { Box, Text } from "ink";
import type { StatusInfo, TuiMode } from "../types.js";
import { COLORS } from "../types.js";

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
};

export function TopStatusBar({ status, mode, version, isProcessing, isPlanMode }: TopStatusBarProps) {
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
        <Text color={COLORS.textDim}> </Text>
        <Text color={COLORS.system} bold>
          {status.model}
        </Text>
        <Text color={COLORS.textDim}> │ </Text>
        <Text color={COLORS.text}>
          {shortDir(status.directory)}
        </Text>
        {status.branch && (
          <>
            <Text color={COLORS.textDim}> ⎇ </Text>
            <Text color="yellow">{status.branch}</Text>
          </>
        )}
      </Box>

      {/* Right: indicators */}
      <Box>
        {status.pendingApprovals > 0 && (
          <>
            <Text color={COLORS.warning} bold>
              ⚠ {status.pendingApprovals} pending
            </Text>
            <Text color={COLORS.textDim}> │ </Text>
          </>
        )}
        {status.backgroundProcesses > 0 && (
          <>
            <Text color={COLORS.system}>
              ⟳ {status.backgroundProcesses} bg
            </Text>
            <Text color={COLORS.textDim}> │ </Text>
          </>
        )}
        <Text color={isProcessing ? COLORS.warning : COLORS.success}>
          {isProcessing ? "● Running" : "○ Ready"}
        </Text>
        <Text color={COLORS.textDim}> │ </Text>
        <Text color={COLORS.textDim}>
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
