// ─── Diff Panel ──────────────────────────────────────────────────
// Independent diff view: file changes, hunks, line-by-line coloring
// Supports per-hunk approval and file navigation

import { Box, Text } from "ink";
import type { DiffFile } from "../types.js";
import { useTheme } from "../hooks/useTheme.js";

interface DiffPanelProps {
  diffs: DiffFile[];
  selectedFileIdx: number;
  scrollOffset: number;
  maxHeight: number;
}

const STATUS_ICON: Record<string, string> = {
  added: "+",
  modified: "~",
  deleted: "-",
  renamed: "→",
};

function useStatusColor(theme: { colors: Record<string, string> }): Record<string, string> {
  return {
    added: theme.colors.success,
    modified: theme.colors.warning,
    deleted: theme.colors.error,
    renamed: theme.colors.system,
  };
}

export function DiffPanel({ diffs, selectedFileIdx, scrollOffset, maxHeight }: DiffPanelProps) {
  const { theme } = useTheme();
  const STATUS_COLOR = useStatusColor(theme);
  if (diffs.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.colors.textDim}>No file changes to display.</Text>
        <Text color={theme.colors.textDim}>Changes will appear here as the agent modifies files.</Text>
      </Box>
    );
  }

  const selectedFile = diffs[Math.min(selectedFileIdx, diffs.length - 1)];

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {/* File tabs */}
      <Box marginBottom={1}>
        {diffs.slice(0, 8).map((df, idx) => {
          const active = idx === selectedFileIdx;
          const icon = STATUS_ICON[df.status] ?? "?";
          const color = STATUS_COLOR[df.status] ?? theme.colors.textDim;
          return (
            <Box key={df.path} marginRight={1}>
              <Text
                color={active ? "black" : color}
                backgroundColor={active ? "white" : undefined}
                bold={active}
              >
                {` ${icon} ${shortName(df.path)} `}
              </Text>
            </Box>
          );
        })}
        {diffs.length > 8 && (
          <Text color={theme.colors.textDim}>+{diffs.length - 8} more</Text>
        )}
      </Box>

      {/* Diff content */}
      {selectedFile && (
        <DiffFileContent
          file={selectedFile}
          scrollOffset={scrollOffset}
          maxLines={maxHeight - 3}
        />
      )}
    </Box>
  );
}

function DiffFileContent({
  file,
  scrollOffset,
  maxLines,
}: {
  file: DiffFile;
  scrollOffset: number;
  maxLines: number;
}) {
  const { theme } = useTheme();
  const STATUS_COLOR = useStatusColor(theme);
  // Flatten all hunks into displayable lines
  const allLines: { type: "header" | "add" | "remove" | "context"; text: string }[] = [];

  for (const hunk of file.hunks) {
    allLines.push({
      type: "header",
      text: `@@ -${hunk.oldStart} +${hunk.newStart} @@`,
    });
    for (const line of hunk.lines) {
      const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
      allLines.push({
        type: line.type,
        text: `${prefix} ${line.content}`,
      });
    }
  }

  const visible = allLines.slice(scrollOffset, scrollOffset + maxLines);

  return (
    <Box flexDirection="column">
      <Box marginBottom={0}>
        <Text color={STATUS_COLOR[file.status] ?? theme.colors.textDim} bold>
          {file.path}
        </Text>
        <Text color={theme.colors.textDim}>
          {" "}({file.status})
        </Text>
      </Box>
      {visible.map((line, i) => {
        const color =
          line.type === "add" ? theme.colors.success :
          line.type === "remove" ? theme.colors.error :
          line.type === "header" ? theme.colors.system :
          theme.colors.textDim;
        return (
          <Text key={scrollOffset + i} color={color} wrap="truncate-end">
            {line.text}
          </Text>
        );
      })}
      {scrollOffset + maxLines < allLines.length && (
        <Text color={theme.colors.textDim}>
          ↓ {allLines.length - scrollOffset - maxLines} more lines (j/k to scroll)
        </Text>
      )}
    </Box>
  );
}

function shortName(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 1) return path;
  return parts[parts.length - 1] ?? path;
}
