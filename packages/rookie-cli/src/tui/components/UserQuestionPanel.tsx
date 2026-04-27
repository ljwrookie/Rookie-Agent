// ─── User Question Panel ─────────────────────────────────────────
// B10.2: Pause execution to ask user for clarification/choice
// Shows question, options, and input field for user response

import { Box, Text } from "ink";
import type { UserQuestionRequest } from "../types.js";
import { COLORS } from "../types.js";

interface UserQuestionPanelProps {
  questions: UserQuestionRequest[];
  selectedIdx: number;
  maxHeight: number;
}

export function UserQuestionPanel({ questions, selectedIdx, maxHeight }: UserQuestionPanelProps) {
  const pending = questions.filter((q) => q.status === "pending");

  if (pending.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={COLORS.textDim}>No pending questions.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      <Box marginBottom={1}>
        <Text bold color={COLORS.warning}>
          {pending.length} pending question{pending.length > 1 ? "s" : ""}
        </Text>
        <Text color={COLORS.textDim}> — waiting for your response</Text>
      </Box>

      {pending
        .slice(0, Math.min(pending.length, maxHeight - 2))
        .map((req, idx) => (
          <QuestionCard
            key={req.id}
            request={req}
            selected={idx === selectedIdx}
          />
        ))}
    </Box>
  );
}

function QuestionCard({
  request,
  selected,
}: {
  request: UserQuestionRequest;
  selected: boolean;
}) {
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
        <Text bold color={COLORS.warning}>
          ? Question
        </Text>
        <Text color={COLORS.textDim}>{fmtTime(request.timestamp)}</Text>
      </Box>

      {/* Question text */}
      <Box marginTop={1}>
        <Text color={COLORS.text} wrap="wrap">
          {request.question}
        </Text>
      </Box>

      {/* Options */}
      {request.options && request.options.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.textDim}>Options:</Text>
          {request.options.map((opt, i) => (
            <Box key={i}>
              <Text color={COLORS.system} bold>
                {i + 1}.{" "}
              </Text>
              <Text color={COLORS.text}>{opt}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Default value hint */}
      {request.defaultValue && (
        <Box marginTop={1}>
          <Text color={COLORS.textDim}>
            Default: <Text color={COLORS.success}>{request.defaultValue}</Text>
          </Text>
        </Box>
      )}

      {/* Status / hint */}
      {selected && (
        <Box marginTop={1}>
          <Text color={COLORS.system}>
            Press <Text bold>Tab</Text> to focus input and type your answer, then{" "}
            <Text bold>Enter</Text> to submit
          </Text>
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
