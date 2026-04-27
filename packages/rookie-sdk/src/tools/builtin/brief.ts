// ─── Brief Tool ──────────────────────────────────────────────────
// B10.6: Brief output mode indicator

import { Tool } from "../types.js";

// Global brief mode state
let briefModeEnabled = false;

export function isBriefMode(): boolean {
  return briefModeEnabled;
}

export function setBriefMode(enabled: boolean): void {
  briefModeEnabled = enabled;
}

/**
 * BriefTool - Toggle brief output mode
 *
 * When enabled, agents should compress their responses and omit
 * redundant explanations, outputting only key information.
 * Useful for batch operations or script mode to reduce token usage.
 */
export const briefTool: Tool = {
  name: "brief",
  description:
    "Toggle brief output mode. When enabled, the agent compresses replies " +
    "and omits redundant explanations, outputting only key information. " +
    "Useful for batch operations or script mode to reduce token consumption.",
  parameters: [
    {
      name: "enabled",
      type: "boolean",
      description: "true to enable brief mode, false to disable",
      required: true,
    },
  ],
  isReadOnly: true,
  isConcurrencySafe: true,
  async execute(params) {
    const enabled = Boolean(params.enabled);
    setBriefMode(enabled);

    if (enabled) {
      return (
        "[BRIEF MODE ON] Responses will be concise.\n\n" +
        "The agent will now:\n" +
        "- Skip redundant explanations\n" +
        "- Output only key information\n" +
        "- Use compact formatting\n\n" +
        "Use brief(false) to restore normal mode."
      );
    } else {
      return "[BRIEF MODE OFF] Responses restored to normal verbosity.";
    }
  },
};

/**
 * Get brief mode instruction for system prompt injection
 */
export function getBriefModePrompt(): string | undefined {
  if (!briefModeEnabled) return undefined;

  return (
    "You are in BRIEF MODE. Compress your responses:\n" +
    "- Omit redundant explanations\n" +
    "- Output only key information\n" +
    "- Use compact formatting\n" +
    "- Skip pleasantries and filler text"
  );
}
