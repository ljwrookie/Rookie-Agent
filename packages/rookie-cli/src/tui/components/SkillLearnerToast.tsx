// ─── Skill Learner Toast ─────────────────────────────────────────
// P3.5: Lightweight toast showing skill learning suggestions at session end.
// Auto-dismisses after 15s or on any key press.

import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../hooks/useTheme.js";

interface SkillCandidate {
  name: string;
  description: string;
  tools: string[];
}

interface SkillLearnerToastProps {
  candidates: SkillCandidate[];
  onDismiss: () => void;
  onSave?: (candidate: SkillCandidate) => void;
}

export function SkillLearnerToast({ candidates, onDismiss, onSave }: SkillLearnerToastProps) {
  const { theme } = useTheme();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  // Auto-dismiss after 15s
  useEffect(() => {
    const t = setTimeout(() => {
      setDismissed(true);
      onDismiss();
    }, 15000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  useInput((input, key) => {
    if (key.escape) {
      setDismissed(true);
      onDismiss();
      return;
    }
    if (key.return) {
      const selected = candidates[selectedIdx];
      if (selected && onSave && input === "s") {
        onSave(selected);
      } else {
        setDismissed(true);
        onDismiss();
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIdx(i => (i <= 0 ? candidates.length - 1 : i - 1));
    } else if (key.downArrow) {
      setSelectedIdx(i => (i >= candidates.length - 1 ? 0 : i + 1));
    }
  });

  if (dismissed || candidates.length === 0) return null;

  const selected = candidates[selectedIdx];

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      borderStyle="round"
      borderColor={theme.colors.system}
      marginBottom={1}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.colors.system}>💡 Skill Suggestion</Text>
        <Text color={theme.colors.textDim}> · {candidates.length} candidate(s) · Esc dismiss · Enter save</Text>
      </Box>

      {candidates.map((c, i) => (
        <Box key={c.name} flexDirection="row" paddingX={1} backgroundColor={i === selectedIdx ? "gray" : undefined}>
          <Box width={3}>
            <Text color={theme.colors.system}>{i === selectedIdx ? "→" : " "}</Text>
          </Box>
          <Box width={20}>
            <Text bold={i === selectedIdx} color={theme.colors.text}>{c.name}</Text>
          </Box>
          <Box flexGrow={1}>
            <Text color={theme.colors.textDim}>{c.description.slice(0, 40)}{c.description.length > 40 ? "…" : ""}</Text>
          </Box>
          <Box width={12}>
            <Text color="gray">{c.tools.length} tools</Text>
          </Box>
        </Box>
      ))}

      {selected && (
        <Box marginTop={1} marginLeft={2}>
          <Text color={theme.colors.textDim}>
            Save as skill? Press Enter to save "{selected.name}"
          </Text>
        </Box>
      )}
    </Box>
  );
}
