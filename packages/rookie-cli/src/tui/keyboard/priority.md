# TUI Keyboard Priority

5-level dispatch pipeline. When a key is pressed, levels are checked in order.
The first level whose matcher returns true gets to handle the key.
If the handler consumes the key, dispatch stops. If not, the next level is tried.

## Level 1: Blocking Interaction

**Trigger:** `hasPendingApproval || hasPendingQuestion || isInterrupting`

**Consumed keys:**
- `a` / `o` — approve once
- `s` — approve session
- `f` — approve forever
- `x` — reject
- `Enter` — answer question
- `r` — retry after interrupt

**Behavior:** All other keys are blocked. The user must resolve the blocking interaction before anything else.

## Level 2: Overlay

**Trigger:** `nav.current.overlay !== null`

**Consumed keys:**
- `Esc` / `Ctrl+O` — close overlay
- `j` / `k` / `PageUp` / `PageDown` — scroll overlay content

**Behavior:** Non-consumed keys fall through to Level 3.

## Level 3: Focused View

**Trigger:** `!inputFocused || isProcessing`

**Consumed keys:**
- `j` / `k` / `↑` / `↓` — scroll event stream
- `G` — jump to latest event
- `Space` / `Enter` — toggle collapse of selected event
- `d` — open diff overlay
- `l` — open logs overlay
- `g` / `b` — enter navigation prefix mode
- `?` — toggle help
- `PageUp` / `PageDown` — page scroll

**Behavior:** Non-consumed keys fall through to Level 4.

## Level 4: Input Editing

**Trigger:** `inputFocused && !isProcessing`

**Consumed keys:**
- `Tab` / `Shift+Tab` — cycle command suggestions
- `Enter` — submit message (or answer question if pending)
- `Alt+Enter` — insert newline
- `↑` / `↓` — input history (when no suggestions) or suggestion cycle
- `←` / `→` — move cursor
- `Backspace` — delete before cursor
- `Delete` — delete after cursor
- Printable characters — insert at cursor

**Behavior:** Non-consumed keys fall through to Level 5.

## Level 5: Global Fallback

**Trigger:** always active

**Consumed keys:**
- `Ctrl+C` — interrupt (if processing) or exit (if pressed twice)
- `Ctrl+L` — clear screen
- `Ctrl+O` — close overlay or go back
- `Esc` — close overlay / return to stream / focus input

## Adding a New Shortcut

1. Decide which level the shortcut belongs to based on when it should be active.
2. Add the key handling to that level in `useKeyboardRouter.ts`.
3. Do **not** modify `app.tsx`. The router is the single source of truth for all keyboard behavior.

## Files

- `hooks/useKeyboardRouter.ts` — implementation
- `keyboard/priority.md` — this document
