// ─── Task Output Tool ────────────────────────────────────────────
// B10.5: Query background task output

import { Tool } from "../types.js";
import { getBackgroundTaskOutput } from "./shell.js";

export const taskOutputTool: Tool = {
  name: "task_output",
  description:
    "Query the output of a background task. " +
    "Use this to check progress of long-running commands that were auto-backgrounded.",
  parameters: [
    { name: "taskId", type: "string", description: "Task ID returned by shell_execute", required: true },
    { name: "offset", type: "number", description: "Character offset to start reading from", required: false },
    { name: "maxChars", type: "number", description: "Maximum characters to return (default 5000)", required: false },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    const taskId = String(params.taskId);
    const offset = typeof params.offset === "number" ? params.offset : 0;
    const maxChars = typeof params.maxChars === "number" ? params.maxChars : 5000;

    const task = getBackgroundTaskOutput(taskId, offset);

    if (!task) {
      return `[ERROR] Task not found: ${taskId}`;
    }

    let output = task.output;

    // Apply maxChars limit
    if (output.length > maxChars) {
      output = output.slice(0, maxChars) + `\n... [${output.length - maxChars} more chars]`;
    }

    const statusEmoji = task.status === "running" ? "⏳" :
                       task.status === "completed" ? "✓" : "✗";

    return `${statusEmoji} Task ${taskId} [${task.status}]${task.exitCode !== undefined ? ` (exit: ${task.exitCode})` : ""}\n\n${output || "(no output yet)"}`;
  },
};
