// ─── Diff Panel ──────────────────────────────────────────────────
// Independent diff view: file changes, hunks, line-by-line coloring
// Supports per-hunk approval and file navigation

import { Box, Text } from "ink";
import type { DiffFile } from "../types.js";
import { COLORS } from "../types.js";

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

const STATUS_COLOR: Record<string, string> = {
  added: COLORS.success,
  modified: COLORS.warning,
  deleted: COLORS.error,
  renamed: COLORS.system,
};

export function DiffPanel({ diffs, selectedFileIdx, scrollOffset, maxHeight }: DiffPanelProps) {
  if (diffs.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={COLORS.textDim}>No file changes to display.</Text>
        <Text color={COLORS.textDim}>Changes will appear here as the agent modifies files.</Text>
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
          const color = STATUS_COLOR[df.status] ?? COLORS.textDim;
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
          <Text color={COLORS.textDim}>+{diffs.length - 8} more</Text>
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
        <Text color={STATUS_COLOR[file.status] ?? COLORS.textDim} bold>
          {file.path}
        </Text>
        <Text color={COLORS.textDim}>
          {" "}({file.status})
        </Text>
      </Box>
      {visible.map((line, i) => {
        const color =
          line.type === "add" ? COLORS.success :
          line.type === "remove" ? COLORS.error :
          line.type === "header" ? COLORS.system :
          COLORS.textDim;
        return (
          <Text key={scrollOffset + i} color={color} wrap="truncate-end">
            {line.text}
          </Text>
        );
      })}
      {scrollOffset + maxLines < allLines.length && (
        <Text color={COLORS.textDim}>
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
