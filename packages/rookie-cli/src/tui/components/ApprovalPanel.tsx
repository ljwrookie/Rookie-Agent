// ─── Approval Panel ──────────────────────────────────────────────
// P0 priority: dangerous operation approval cards
// Shows action type, scope, risk level, approve/reject/edit controls

import { Box, Text } from "ink";
import type { ApprovalRequest, RiskLevel } from "../types.js";
import { COLORS } from "../types.js";

interface ApprovalPanelProps {
  approvals: ApprovalRequest[];
  selectedIdx: number;
  maxHeight: number;
}

const RISK_COLOR: Record<RiskLevel, string> = {
  low: COLORS.success,
  medium: COLORS.warning,
  high: "red",
  critical: "redBright",
};

const RISK_ICON: Record<RiskLevel, string> = {
  low: "○",
  medium: "◑",
  high: "●",
  critical: "◉",
};

const ACTION_ICON: Record<string, string> = {
  shell_execute: "$",
  file_write: "✎",
  file_edit: "✎",
  git_push: "⇪",
  network: "⇄",
  other: "?",
};

export function ApprovalPanel({ approvals, selectedIdx, maxHeight }: ApprovalPanelProps) {
  const pending = approvals.filter(a => a.status === "pending");

  if (pending.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={COLORS.textDim}>No pending approvals.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      <Box marginBottom={1}>
        <Text bold color={COLORS.warning}>
          {pending.length} pending approval{pending.length > 1 ? "s" : ""}
        </Text>
        <Text color={COLORS.textDim}> — </Text>
        <Text bold color={COLORS.success}>o</Text>
        <Text color={COLORS.textDim}>nce · </Text>
        <Text bold color={COLORS.success}>s</Text>
        <Text color={COLORS.textDim}>ession · </Text>
        <Text bold color={COLORS.success}>f</Text>
        <Text color={COLORS.textDim}>orever · </Text>
        <Text bold color={COLORS.error}>x</Text>
        <Text color={COLORS.textDim}> reject</Text>
      </Box>

      {pending.slice(0, Math.min(pending.length, maxHeight - 2)).map((req, idx) => (
        <ApprovalCard key={req.id} request={req} selected={idx === selectedIdx} />
      ))}
    </Box>
  );
}

function ApprovalCard({ request, selected }: { request: ApprovalRequest; selected: boolean }) {
  const riskColor = RISK_COLOR[request.riskLevel];
  const riskIcon = RISK_ICON[request.riskLevel];
  const actionIcon = ACTION_ICON[request.action] ?? "?";
  const borderColor = selected ? COLORS.system : COLORS.border;

  return (
    <Box
      borderStyle="round"
      borderColor={borderColor}
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      {/* Header */}
      <Box justifyContent="space-between">
        <Box>
          <Text color={riskColor} bold>
            {riskIcon} {request.riskLevel.toUpperCase()}
          </Text>
          <Text color={COLORS.textDim}> │ </Text>
          <Text color={COLORS.toolName}>
            {actionIcon} {request.action}
          </Text>
        </Box>
        <Text color={COLORS.textDim}>
          {fmtTime(request.timestamp)}
        </Text>
      </Box>

      {/* Scope */}
      <Box marginTop={0}>
        <Text color={COLORS.text} wrap="truncate-end">
          {request.description}
        </Text>
      </Box>

      {/* Detail (truncated preview) */}
      {request.detail && (
        <Box marginTop={0} flexDirection="column">
          {request.detail.split("\n").slice(0, 4).map((line, i) => (
            <Text key={i} color={COLORS.textDim} wrap="truncate-end">
              {line}
            </Text>
          ))}
          {request.detail.split("\n").length > 4 && (
            <Text color={COLORS.textDim}>...</Text>
          )}
        </Box>
      )}

      {/* Action hints */}
      {selected && (
        <Box marginTop={0}>
          <Text color={COLORS.success}>[o]nce</Text>
          <Text color={COLORS.textDim}> │ </Text>
          <Text color={COLORS.success}>[s]ession</Text>
          <Text color={COLORS.textDim}> │ </Text>
          <Text color={COLORS.success}>[f]orever</Text>
          <Text color={COLORS.textDim}> │ </Text>
          <Text color={COLORS.error}>[x]reject</Text>
        </Box>
      )}
    </Box>
  );
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
