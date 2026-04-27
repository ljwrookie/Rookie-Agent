// ─── Error Display ───────────────────────────────────────────────
// Structured error cards: severity, cause, suggestion, retryable

import { Box, Text } from "ink";
import type { StructuredError } from "../types.js";
import { COLORS } from "../types.js";

interface ErrorDisplayProps {
  errors: StructuredError[];
  maxErrors?: number;
}

const SEV_ICON: Record<string, string> = {
  warning: "⚠",
  error: "✗",
  fatal: "☠",
};

const SEV_COLOR: Record<string, string> = {
  warning: COLORS.warning,
  error: COLORS.error,
  fatal: "redBright",
};

export function ErrorDisplay({ errors, maxErrors = 3 }: ErrorDisplayProps) {
  const recent = errors.slice(-maxErrors);

  if (recent.length === 0) return null;

  return (
    <Box flexDirection="column">
      {recent.map(err => (
        <ErrorCard key={err.id} error={err} />
      ))}
    </Box>
  );
}

function ErrorCard({ error }: { error: StructuredError }) {
  const icon = SEV_ICON[error.severity] ?? "?";
  const color = SEV_COLOR[error.severity] ?? COLORS.error;

  return (
    <Box
      borderStyle="round"
      borderColor={color}
      flexDirection="column"
      paddingX={1}
      marginBottom={1}
    >
      {/* Header */}
      <Box>
        <Text color={color} bold>
          {icon} {error.severity.toUpperCase()}
        </Text>
        <Text color={COLORS.textDim}> │ </Text>
        <Text color={COLORS.text} bold wrap="truncate-end">
          {error.title}
        </Text>
      </Box>

      {/* Cause */}
      {error.cause && (
        <Box>
          <Text color={COLORS.textDim}>Cause: </Text>
          <Text color={COLORS.text} wrap="truncate-end">{error.cause}</Text>
        </Box>
      )}

      {/* Suggestion */}
      {error.suggestion && (
        <Box>
          <Text color={COLORS.system}>→ </Text>
          <Text color={COLORS.system} wrap="truncate-end">{error.suggestion}</Text>
        </Box>
      )}

      {/* Retry hint */}
      {error.retryable && (
        <Box>
          <Text color={COLORS.textDim}>Press </Text>
          <Text bold color={COLORS.system}>r</Text>
          <Text color={COLORS.textDim}> to retry</Text>
        </Box>
      )}
    </Box>
  );
}
