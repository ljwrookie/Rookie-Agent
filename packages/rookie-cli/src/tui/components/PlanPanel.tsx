// ─── Plan Panel ──────────────────────────────────────────────────
// Shows current plan: todo items, phases, completion percentage

import { Box, Text } from "ink";
import type { PlanState } from "../types.js";
import { useTheme } from "../hooks/useTheme.js";

interface PlanPanelProps {
  plan: PlanState | null;
  maxHeight: number;
}

export function PlanPanel({ plan, maxHeight }: PlanPanelProps) {
  const { theme } = useTheme();
  if (!plan) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.colors.textDim}>No active plan.</Text>
      </Box>
    );
  }

  const doneCount = plan.steps.filter(s => s.status === "done").length;
  const barWidth = 20;
  const filled = Math.round(barWidth * (plan.completionPct / 100));

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {/* Title + progress */}
      <Box justifyContent="space-between">
        <Text bold color={theme.colors.text}>
          {plan.title}
        </Text>
        <Text color={theme.colors.textDim}>
          {doneCount}/{plan.steps.length} ({plan.completionPct}%)
        </Text>
      </Box>

      {/* Progress bar */}
      <Box>
        <Text color={theme.colors.textDim}>[</Text>
        <Text color={theme.colors.success}>{"█".repeat(filled)}</Text>
        <Text color={theme.colors.textDim}>{"░".repeat(Math.max(0, barWidth - filled))}</Text>
        <Text color={theme.colors.textDim}>]</Text>
      </Box>

      {/* Steps */}
      <Box flexDirection="column" marginTop={1}>
        {plan.steps.slice(0, maxHeight - 4).map((step) => (
          <PlanStepRow key={step.id} step={step} />
        ))}
        {plan.steps.length > maxHeight - 4 && (
          <Text color={theme.colors.textDim}>
            ... {plan.steps.length - (maxHeight - 4)} more steps
          </Text>
        )}
      </Box>
    </Box>
  );
}

function PlanStepRow({ step }: { step: PlanState["steps"][0] }) {
  const { theme } = useTheme();
  const icons: Record<string, string> = {
    pending: "○",
    active: "◉",
    done: "✓",
    error: "✗",
    skipped: "⊘",
  };

  const colors: Record<string, string> = {
    pending: theme.colors.textDim,
    active: theme.colors.system,
    done: theme.colors.success,
    error: theme.colors.error,
    skipped: theme.colors.textDim,
  };

  const icon = icons[step.status] ?? "·";
  const color = colors[step.status] ?? theme.colors.textDim;
  const duration = step.durationMs ? ` ${fmtDuration(step.durationMs)}` : "";

  return (
    <Box justifyContent="space-between">
      <Box>
        <Text color={color}>
          {icon} {step.title}
        </Text>
      </Box>
      <Text color={theme.colors.textDim}>{duration}</Text>
    </Box>
  );
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
