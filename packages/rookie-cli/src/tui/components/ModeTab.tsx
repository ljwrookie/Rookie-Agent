// ─── Mode Tab Bar ────────────────────────────────────────────────
// Horizontal tab bar for mode switching: Chat | Plan | Diff | Logs | Review

import { Box, Text } from "ink";
import type { TuiMode } from "../types.js";
import { COLORS } from "../types.js";

interface ModeTabProps {
  current: TuiMode;
  pendingApprovals: number;
  diffCount: number;
  errorCount: number;
}

interface TabDef {
  mode: TuiMode;
  label: string;
  key: string; // shortcut key
}

const TABS: TabDef[] = [
  { mode: "chat", label: "Chat", key: "1" },
  { mode: "plan", label: "Plan", key: "2" },
  { mode: "diff", label: "Diff", key: "3" },
  { mode: "logs", label: "Logs", key: "4" },
  { mode: "review", label: "Review", key: "5" },
];

export function ModeTab({ current, pendingApprovals, diffCount, errorCount }: ModeTabProps) {
  return (
    <Box paddingX={1}>
      {TABS.map((tab, idx) => {
        const active = tab.mode === current;
        const badge = getBadge(tab.mode, pendingApprovals, diffCount, errorCount);

        return (
          <Box key={tab.mode} marginRight={idx < TABS.length - 1 ? 1 : 0}>
            <Text
              color={active ? "black" : COLORS.textDim}
              backgroundColor={active ? "white" : undefined}
              bold={active}
            >
              {` ${tab.key}:${tab.label} `}
            </Text>
            {badge > 0 && (
              <Text color={tab.mode === "review" ? COLORS.error : COLORS.warning}>
                ({badge})
              </Text>
            )}
          </Box>
        );
      })}

      {/* Approval tab (special) */}
      {pendingApprovals > 0 && (
        <Box marginLeft={1}>
          <Text
            color={current === "approve" ? "black" : COLORS.warning}
            backgroundColor={current === "approve" ? COLORS.warning : undefined}
            bold
          >
            {` ⚠ Approve (${pendingApprovals}) `}
          </Text>
        </Box>
      )}
    </Box>
  );
}

function getBadge(mode: TuiMode, pending: number, diffs: number, errors: number): number {
  switch (mode) {
    case "diff": return diffs;
    case "review": return errors;
    case "approve": return pending;
    default: return 0;
  }
}
