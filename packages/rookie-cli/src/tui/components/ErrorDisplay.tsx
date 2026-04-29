// ─── Error Display ───────────────────────────────────────────────
// Structured error cards: severity, cause, suggestion, retryable

import { Box, Text } from "ink";
import type { StructuredError } from "../types.js";
import { useTheme } from "../hooks/useTheme.js";

interface ErrorDisplayProps {
  errors: StructuredError[];
  maxErrors?: number;
}

const SEV_ICON: Record<string, string> = {
  warning: "⚠",
  error: "✗",
  fatal: "☠",
};

function useSevColor(theme: { colors: Record<string, string> }): Record<string, string> {
  return {
    warning: theme.colors.warning,
    error: theme.colors.error,
    fatal: "redBright",
  };
}

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
  const { theme } = useTheme();
  const SEV_COLOR = useSevColor(theme);
  const icon = SEV_ICON[error.severity] ?? "?";
  const color = SEV_COLOR[error.severity] ?? theme.colors.error;

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
        <Text color={theme.colors.textDim}> │ </Text>
        <Text color={theme.colors.text} bold wrap="truncate-end">
          {error.title}
        </Text>
      </Box>

      {/* Cause */}
      {error.cause && (
        <Box>
          <Text color={theme.colors.textDim}>Cause: </Text>
          <Text color={theme.colors.text} wrap="truncate-end">{error.cause}</Text>
        </Box>
      )}

      {/* Suggestion */}
      {error.suggestion && (
        <Box>
          <Text color={theme.colors.system}>→ </Text>
          <Text color={theme.colors.system} wrap="truncate-end">{error.suggestion}</Text>
        </Box>
      )}

      {/* Retry hint */}
      {error.retryable && (
        <Box>
          <Text color={theme.colors.textDim}>Press </Text>
          <Text bold color={theme.colors.system}>r</Text>
          <Text color={theme.colors.textDim}> to retry</Text>
        </Box>
      )}
    </Box>
  );
}
