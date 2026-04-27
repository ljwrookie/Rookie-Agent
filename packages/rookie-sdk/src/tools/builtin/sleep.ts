// ─── Sleep Tool ──────────────────────────────────────────────────
// B10.6: Wait for a specified duration

import { Tool } from "../types.js";

export function createSleepTool(): Tool {
  return {
    name: "Sleep",
    description:
      "Wait for a specified duration before continuing. " +
      "Use this to add delays, wait for external processes, or rate-limit operations. " +
      "Maximum sleep duration is 60 seconds.",
    parameters: [
      {
        name: "duration",
        type: "number",
        description: "Duration to sleep in milliseconds",
        required: true,
      },
      {
        name: "reason",
        type: "string",
        description: "Reason for sleeping (for logging)",
        required: false,
      },
    ],
    isReadOnly: true,
    isConcurrencySafe: true,
    async execute(params: Record<string, unknown>): Promise<string> {
      const duration = Number(params.duration);
      const reason = params.reason ? String(params.reason) : undefined;

      // Validate duration
      if (isNaN(duration) || duration < 0) {
        return "[ERROR] Duration must be a non-negative number (milliseconds)";
      }

      // Cap at 60 seconds for safety
      const actualDuration = Math.min(duration, 60000);

      if (actualDuration < duration) {
        return `[WARNING] Sleep duration capped at 60s. Requested: ${duration}ms, Actual: ${actualDuration}ms`;
      }

      // Perform sleep
      await new Promise(resolve => setTimeout(resolve, actualDuration));

      let response = `Slept for ${formatDuration(actualDuration)}`;
      if (reason) {
        response += ` (${reason})`;
      }

      return response;
    },
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m${secs}s`;
}

export const sleepTool: Tool = createSleepTool();
