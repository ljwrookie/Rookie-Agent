// ─── Status Line Component ───────────────────────────────────────
// A7: Dedicated status line showing session info, model, git state

import { Box, Text } from "ink";
import type { StatusInfo } from "../types.js";
import { COLORS } from "../types.js";

interface StatusLineProps {
  status: StatusInfo;
  compact?: boolean;
}

export function StatusLine({ status, compact = false }: StatusLineProps) {
  const { model, directory, branch, permissions, taskStatus, streamStatus } = status;

  // A7: Stream status indicator
  const streamIndicator = streamStatus === "stalled" ? "⏳" :
                          streamStatus === "recovering" ? "🔄" :
                          streamStatus === "streaming" ? "◉" : "○";

  const streamColor = streamStatus === "stalled" ? COLORS.error :
                      streamStatus === "recovering" ? COLORS.warning :
                      streamStatus === "streaming" ? COLORS.success : COLORS.textDim;

  if (compact) {
    return (
      <Box>
        <Text color={streamColor}>{streamIndicator}</Text>
        <Text color={COLORS.textDim}> │ </Text>
        <Text color={COLORS.system}>{model}</Text>
        {branch && (
          <>
            <Text color={COLORS.textDim}> │ </Text>
            <Text color={COLORS.success}>{branch}</Text>
          </>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Main status line */}
      <Box justifyContent="space-between">
        <Box>
          {/* Stream status */}
          <Text color={streamColor} bold>{streamIndicator}</Text>
          <Text color={COLORS.textDim}> │ </Text>

          {/* Model */}
          <Text color={COLORS.system}>{model}</Text>

          {/* Directory */}
          <Text color={COLORS.textDim}> │ </Text>
          <Text color={COLORS.text}>{shortDir(directory)}</Text>

          {/* Git branch */}
          {branch && (
            <>
              <Text color={COLORS.textDim}> │ </Text>
              <Text color={COLORS.success}>{branch}</Text>
            </>
          )}
        </Box>

        <Box>
          {/* Task status */}
          <Text color={getTaskStatusColor(taskStatus)}>{taskStatus}</Text>

          {/* Permissions */}
          <Text color={COLORS.textDim}> │ </Text>
          <Text color={getPermissionColor(permissions)}>{permissions}</Text>
        </Box>
      </Box>

      {/* Secondary info line */}
      <Box justifyContent="space-between">
        <Box>
          <Text color={COLORS.textDim}>
            bg:{status.backgroundProcesses} │ pending:{status.pendingApprovals}
          </Text>
        </Box>
        {streamStatus === "stalled" && (
          <Text color={COLORS.error}>Stream stalled - attempting recovery...</Text>
        )}
        {streamStatus === "recovering" && (
          <Text color={COLORS.warning}>Recovering stream...</Text>
        )}
      </Box>
    </Box>
  );
}

function shortDir(dir: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (home && dir.startsWith(home)) return "~" + dir.slice(home.length);
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 2) return dir;
  return ".../" + parts.slice(-2).join("/");
}

function getTaskStatusColor(status: string): string {
  switch (status) {
    case "running": return COLORS.warning;
    case "stalled": return COLORS.error;
    case "idle": return COLORS.textDim;
    default: return COLORS.text;
  }
}

function getPermissionColor(perm: string): string {
  switch (perm) {
    case "strict": return COLORS.error;
    case "normal": return COLORS.success;
    case "permissive": return COLORS.warning;
    default: return COLORS.textDim;
  }
}
