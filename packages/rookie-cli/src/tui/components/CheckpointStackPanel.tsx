// ─── Checkpoint Stack Panel ──────────────────────────────────────
// P3.3: Shows undo/redo history with j/k navigation.
// g u to open, Esc to close, Enter to restore selected checkpoint.

import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../hooks/useTheme.js";
import type { CheckpointEntry } from "../hooks/useCheckpointStack.js";

interface CheckpointStackPanelProps {
  entries: CheckpointEntry[];
  pointer: number;       // undo pointer: entries[0..pointer] are "done"
  onRestore: (id: string) => void;
  onClose: () => void;
  maxHeight: number;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function formatRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function CheckpointStackPanel({ entries, pointer, onRestore, onClose, maxHeight }: CheckpointStackPanelProps) {
  const { theme } = useTheme();
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Auto-select most recent entry
  useEffect(() => {
    setSelectedIdx(Math.max(0, entries.length - 1));
  }, [entries.length]);

  useInput((_input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.return) {
      const selected = entries[selectedIdx];
      if (selected) onRestore(selected.id);
      return;
    }
    if (key.upArrow) {
      setSelectedIdx(i => (i <= 0 ? entries.length - 1 : i - 1));
    } else if (key.downArrow) {
      setSelectedIdx(i => (i >= entries.length - 1 ? 0 : i + 1));
    }
  });

  if (entries.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={theme.colors.system}>Checkpoint History</Text>
        <Text color="gray">No checkpoints yet. Checkpoints are created automatically before file edits.</Text>
        <Box marginTop={1}><Text color={theme.colors.textDim}>Esc to close</Text></Box>
      </Box>
    );
  }

  const visibleCount = Math.max(3, maxHeight - 5);
  const startIdx = Math.max(0, Math.min(selectedIdx, entries.length - visibleCount));
  const visible = entries.slice(startIdx, startIdx + visibleCount);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.colors.system}>Checkpoint History</Text>
        <Text color={theme.colors.textDim}> · {entries.length} checkpoint(s) · pointer={pointer}</Text>
      </Box>

      {visible.map((entry, vi) => {
        const idx = startIdx + vi;
        const isSelected = idx === selectedIdx;
        const isUndoable = idx <= pointer;     // these are "done" actions
        const isRedoable = idx === pointer + 1; // next to redo

        return (
          <Box key={entry.id} flexDirection="row" paddingX={1} backgroundColor={isSelected ? "gray" : undefined}>
            <Box width={3}>
              <Text color={isUndoable ? theme.colors.success : theme.colors.textDim}>
                {isUndoable ? "✓" : isRedoable ? "→" : "○"}
              </Text>
            </Box>
            <Box width={12}>
              <Text color={theme.colors.textDim}>{formatTime(entry.timestamp)}</Text>
            </Box>
            <Box width={10}>
              <Text color="gray">{formatRelative(entry.timestamp)}</Text>
            </Box>
            <Box width={8}>
              <Text color="gray">{(entry.size / 1024).toFixed(1)}k</Text>
            </Box>
            <Box flexGrow={1}>
              <Text
                bold={isSelected}
                color={isSelected ? theme.colors.text : theme.colors.textDim}
              >
                {entry.label}
              </Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color={theme.colors.textDim}>
          ↑/↓ select · Enter=restore · ✓=undoable →=next redo · Esc=close
        </Text>
      </Box>
    </Box>
  );
}
