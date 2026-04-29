// ─── Keyboard Pipeline ───────────────────────────────────────────
// Declarative 5-level keyboard dispatch. Re-exports the router and
// defines the priority constants for documentation alignment.

export { useKeyboardRouter, type KeyContext, type KeyboardActions, type KeyboardResult } from "../hooks/useKeyboardRouter.js";

/** Priority levels — checked in ascending order */
export const LEVELS = [
  "blocking",
  "overlay",
  "focused",
  "input",
  "global",
] as const;

export type KeyboardLevel = typeof LEVELS[number];
