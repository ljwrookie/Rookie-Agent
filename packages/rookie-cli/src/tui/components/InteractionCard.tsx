// ─── Interaction Card ────────────────────────────────────────────
// Unified inline card for blocking interactions: approval / question
// Renders inside the event stream instead of as an overlay

import { Box, Text } from "ink";
import { useTheme } from "../hooks/useTheme.js";
import type { ApprovalRequest, RiskLevel, UserQuestionRequest } from "../types.js";

interface InteractionCardProps {
  type: "approval" | "question";
  approval?: ApprovalRequest;
  question?: UserQuestionRequest;
  // Callbacks reserved for future interactive handling (currently handled by keyboard router)
  // onApprove?: (remember?: "once" | "session" | "forever") => void;
  // onReject?: () => void;
  // onAnswer?: (answer: string) => void;
}

const RISK_ICON: Record<RiskLevel, string> = {
  low: "○",
  medium: "◐",
  high: "◉",
  critical: "☠",
};

export function InteractionCard({ type, approval, question }: InteractionCardProps) {
  const { theme } = useTheme();

  if (type === "approval" && approval) {
    const riskColor =
      approval.riskLevel === "critical" ? theme.colors.fatal :
      approval.riskLevel === "high" ? theme.colors.error :
      approval.riskLevel === "medium" ? theme.colors.warning : theme.colors.success;

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={riskColor}
        paddingX={1}
        marginBottom={1}
      >
        <Box>
          <Text color={riskColor} bold>
            {RISK_ICON[approval.riskLevel]} {approval.action}
          </Text>
          <Text color={theme.colors.textDim}> │ </Text>
          <Text color={theme.colors.text} bold wrap="truncate-end">
            {approval.description}
          </Text>
        </Box>
        {approval.detail && (
          <Box>
            <Text color={theme.colors.textDim} wrap="truncate-end">{approval.detail}</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.colors.textDim}>Press </Text>
          <Text bold color={theme.colors.success}>o</Text>
          <Text color={theme.colors.textDim}>=once </Text>
          <Text bold color={theme.colors.success}>s</Text>
          <Text color={theme.colors.textDim}>=session </Text>
          <Text bold color={theme.colors.success}>f</Text>
          <Text color={theme.colors.textDim}>=forever </Text>
          <Text bold color={theme.colors.error}>x</Text>
          <Text color={theme.colors.textDim}>=reject</Text>
        </Box>
      </Box>
    );
  }

  if (type === "question" && question) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.colors.system}
        paddingX={1}
        marginBottom={1}
      >
        <Box>
          <Text color={theme.colors.system} bold>? Question</Text>
        </Box>
        <Box>
          <Text color={theme.colors.text}>{question.question}</Text>
        </Box>
        {question.options && question.options.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            {question.options.map((opt, i) => (
              <Box key={i}>
                <Text color={theme.colors.textDim}>{i + 1}. </Text>
                <Text color={theme.colors.text}>{opt}</Text>
              </Box>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Text color={theme.colors.textDim}>Type answer and press </Text>
          <Text bold color={theme.colors.system}>Enter</Text>
        </Box>
      </Box>
    );
  }

  return null;
}
