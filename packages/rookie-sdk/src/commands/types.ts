/**
 * Slash Command Registry (P1-T2)
 *
 * A lightweight abstraction that lets the TUI, Skills, and external embedders
 * share a single source of truth for `/` commands. Each command carries enough
 * metadata for suggestion rendering, and a handler that either:
 *   - produces a prompt/system message to feed the agent loop, or
 *   - requests a pure UI side-effect (switch mode, clear screen, show help…).
 *
 * Kept deliberately minimal so CLI / TUI / future surfaces can layer their own
 * concerns (history navigation, fuzzy matching) on top.
 */

import type { Skill } from "../skills/types.js";

/**
 * Categorical bucket used by the TUI to group suggestions. Also carried on the
 * result so the CLI side can route `ui` actions without string sniffing.
 */
export type SlashCommandCategory =
  | "navigation"   // /plan /diff /logs /context …
  | "workflow"    // /plan /commit /review /verify /compact /schedule …
  | "system"      // /help /clear /status /config /doctor /hook …
  | "skill"       // contributed by SKILL.md
  | "custom";

/**
 * Actions the TUI should take after a command fires.
 *
 *   - `prompt`         : feed the given string to the agent loop as if the user
 *                        had typed it.
 *   - `systemMessage`  : append an info-level system event to the stream.
 *   - `mode`           : switch the TUI view (delegated via ctx.setMode).
 *   - `clear`          : clear the event stream.
 *   - `showHelp`       : open the help panel.
 *   - `silent`         : do nothing — handler already did the side-effect.
 */
export interface SlashCommandResult {
  prompt?: string;
  systemMessage?: string;
  mode?: "chat" | "plan" | "diff" | "logs" | "review" | "approve" | "agents";
  clear?: boolean;
  showHelp?: boolean;
  silent?: boolean;
  /** A3: Theme change request */
  theme?: "dark" | "light" | "high-contrast";
}

/**
 * Context passed into every command handler. Handlers are deliberately kept
 * pure w.r.t. the TUI: instead of reaching into `state`, they *return* an
 * intent, and the TUI applies it. That keeps the registry usable from
 * non-interactive entry points (e.g. `rookie -p "/commit"`).
 */
export interface SlashCommandContext {
  /** The entire input line including the slash, e.g. "/diff --staged" */
  raw: string;
  /** The command name without leading slash, lower-cased. */
  name: string;
  /** Tokens after the command name. */
  args: string[];
  /** Current working directory (usually projectRoot). */
  cwd: string;
  /** Optional metadata the TUI may inject (model, sessionId, mode…). */
  meta?: Record<string, unknown>;
}

export type SlashCommandHandler = (
  ctx: SlashCommandContext,
) => SlashCommandResult | Promise<SlashCommandResult>;

export interface SlashCommand {
  /** Name without leading slash, e.g. "commit". */
  name: string;
  /** One-line help blurb for the suggestion popup. */
  description: string;
  /** Canonical usage string, e.g. "/diff [--staged]". */
  usage?: string;
  /** Short hint for args, shown under the selected suggestion. */
  paramsHint?: string;
  /** Registry category / grouping bucket. */
  category?: SlashCommandCategory;
  /** Aliases (without leading slash). */
  aliases?: string[];
  /** Source — built-in vs. a Skill-sourced command. */
  source?: "builtin" | "skill" | "user";
  /** Optional reference back to the originating Skill. */
  skill?: Skill;
  /** Handler — returns the intent the TUI should materialise. */
  handler: SlashCommandHandler;
}
