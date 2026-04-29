// ─── Keyboard Router Hook ────────────────────────────────────────
// Layered keyboard event routing that replaces the 142-line useInput callback.
// Separates concerns: navigation, input editing, scrolling, approvals.

import { useState, useCallback, useRef } from "react";
import type { ViewState } from "./useNavigation.js";

export interface KeyContext {
  view: ViewState;
  isProcessing: boolean;
  inputFocused: boolean;
  inputText: string;
  hasPendingApproval: boolean;
  hasPendingQuestion: boolean;
  cmdSuggestionsCount: number;
  cmdSelected: number;
  showHelp: boolean;
}

export interface KeyboardActions {
  onNavigate: (target: Partial<ViewState>) => void;
  onGoBack: () => void;
  onCloseOverlay: () => void;
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onApproval: (allowed: boolean, remember?: "once" | "session" | "forever") => void;
  onQuestionAnswer: (answer: string) => void;
  onScroll: (dir: 1 | -1, page?: boolean) => void;
  onScrollToEnd: () => void;
  onToggleCollapse: () => void;
  onFocusInput: () => void;
  onBlurInput: () => void;
  onExit: () => void;
  onClearScreen: () => void;
  onToggleHelp: () => void;
  onRetry: () => void;
  onCycleDiffFile: (dir: 1 | -1) => void;
  onSetCmdSelected: (idx: number | ((prev: number) => number)) => void;
  onUseSuggestion: (value: string) => void;
  onInputChange: (updater: (prev: string) => string) => void;
  onCursorChange: (updater: (prev: number) => number) => void;
  onHistoryNav: (dir: 1 | -1) => void;
  onInputEdit: (op: { type: "insert"; text: string } | { type: "delete"; direction: "back" | "forward" } | { type: "newline" }) => void;
}

export interface KeyboardResult {
  consumed: boolean;
  hint?: string;
}

export function useKeyboardRouter(actions: KeyboardActions) {
  const [prefixState, setPrefixState] = useState<string | null>(null);
  const [exitPending, setExitPending] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelExitPending = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    setExitPending(false);
  }, []);

  const route = useCallback(
    (ch: string, key: any, ctx: KeyContext): KeyboardResult => {
      // ── 1. Highest priority: Ctrl+C interrupt / exit ──
      if (key.ctrl && ch === "c") {
        if (ctx.isProcessing) {
          actions.onInterrupt();
        } else if (exitPending) {
          cancelExitPending();
          actions.onExit();
        } else {
          setExitPending(true);
          exitTimerRef.current = setTimeout(() => {
            setExitPending(false);
          }, 2000);
        }
        return { consumed: true };
      }

      // ── 1.5 Help hotkey (always available): Ctrl+H ──
      if (key.ctrl && ch === "h") {
        actions.onToggleHelp();
        return { consumed: true };
      }

      // Any other key cancels exit pending
      if (exitPending && !(key.ctrl && ch === "c")) {
        cancelExitPending();
      }

      // ── 2. Help panel toggle ──
      // `?` should not block normal typing. Allow it when:
      // - input is not focused (navigation mode)
      // - or task is running (input disabled)
      // - or input is focused but currently empty (discoverability)
      if (ch === "?" && (!ctx.inputFocused || ctx.isProcessing || (ctx.inputFocused && ctx.inputText.trim().length === 0))) {
        actions.onToggleHelp();
        return { consumed: true };
      }

      // When help is shown, only Esc/?/q close it; arrow keys scroll help content
      if (ctx.showHelp) {
        if (key.escape || ch === "?" || ch === "q") {
          actions.onToggleHelp();
          return { consumed: true };
        }
        // Allow arrow keys to scroll help content instead of input history
        if (key.upArrow || key.downArrow) {
          return { consumed: true };
        }
        // Block all other keys to prevent background interactions
        return { consumed: true };
      }

      // ── 3. Ctrl+L clear screen ──
      if (key.ctrl && ch === "l") {
        actions.onClearScreen();
        return { consumed: true };
      }

      // ── 4. Prefix navigation mode ──
      if (prefixState) {
        // Let the navigation hook handle the second key
        setPrefixState(null);
        return { consumed: false }; // Will be handled by useNavigation.handlePrefix
      }

      if (!ctx.inputFocused || ctx.isProcessing) {
        if (ch === "g" || ch === "b") {
          setPrefixState(ch);
          return {
            consumed: true,
            hint:
              ch === "g"
                ? "g: c=chat p=plan d=diff l=logs r=review a=agents m=model u=checkpoint s=skill y=memory"
                : "b: c=context f=files a=agents m=commands",
          };
        }

        // ── 5. Global shortcuts ──
        if (key.ctrl && ch === "o") {
          if (ctx.view.overlay) {
            actions.onCloseOverlay();
          } else {
            actions.onGoBack();
          }
          return { consumed: true };
        }

        if (key.escape) {
          if (ctx.view.overlay) {
            actions.onCloseOverlay();
          } else if (ctx.view.primary !== "stream") {
            actions.onNavigate({ primary: "stream", overlay: null });
          } else {
            actions.onFocusInput();
          }
          return { consumed: true };
        }

        // ── 6. Quick overlays ──
        if (ch === "d") {
          actions.onNavigate({ overlay: "diff" });
          return { consumed: true };
        }
        if (ch === "l") {
          actions.onNavigate({ overlay: "logs" });
          return { consumed: true };
        }

        // ── 7. Approval shortcuts ──
        if (ctx.hasPendingApproval) {
          if (ch === "o" || ch === "a") {
            actions.onApproval(true, "once");
            return { consumed: true };
          }
          if (ch === "s") {
            actions.onApproval(true, "session");
            return { consumed: true };
          }
          if (ch === "f") {
            actions.onApproval(true, "forever");
            return { consumed: true };
          }
          if (ch === "x") {
            actions.onApproval(false, "once");
            return { consumed: true };
          }
        }

        // ── 7.5 Diff view: cycle files ──
        if (ctx.view.overlay === "diff" && key.tab) {
          actions.onCycleDiffFile(key.shift ? -1 : 1);
          return { consumed: true };
        }

        // ── 8. Scroll navigation ──
        if (key.pageDown) {
          actions.onScroll(1, true);
          return { consumed: true };
        }
        if (key.pageUp) {
          actions.onScroll(-1, true);
          return { consumed: true };
        }
        if (ch === "j" || key.downArrow) {
          actions.onScroll(1);
          return { consumed: true };
        }
        if (ch === "k" || key.upArrow) {
          actions.onScroll(-1);
          return { consumed: true };
        }
        if (ch === "G") {
          actions.onScrollToEnd();
          return { consumed: true };
        }

        // ── 9. Toggle / interact ──
        if (key.return || ch === " ") {
          actions.onToggleCollapse();
          return { consumed: true };
        }

        // ── 10. Retry ──
        if (ch === "r" && !ctx.isProcessing) {
          actions.onRetry();
          return { consumed: true };
        }

        // ── 11. Focus input ──
        if (key.tab || ch === "i") {
          actions.onFocusInput();
          return { consumed: true };
        }
      }

      // ── 12. Input editing mode ──
      if (ctx.inputFocused && !ctx.isProcessing) {
        // Esc leaves input-focus so navigation keys work
        if (key.escape) {
          actions.onBlurInput();
          return { consumed: true };
        }

        // Tab cycles through command suggestions
        if (key.tab && ctx.cmdSuggestionsCount > 0) {
          if (key.shift) {
            actions.onSetCmdSelected(
              (prev) =>
                (prev - 1 + ctx.cmdSuggestionsCount) % ctx.cmdSuggestionsCount
            );
          } else {
            actions.onUseSuggestion("__tab__");
          }
          return { consumed: true };
        }

        // No suggestions: Tab toggles focus (enter navigation mode)
        if (key.tab && ctx.cmdSuggestionsCount === 0) {
          actions.onBlurInput();
          return { consumed: true };
        }

        // Alt+Enter multi-line
        if (key.return && key.meta) {
          actions.onInputEdit({ type: "newline" });
          return { consumed: true };
        }

        // Enter submit
        if (key.return) {
          actions.onSubmit("__enter__");
          return { consumed: true };
        }

        // Command suggestion navigation (priority over history)
        if (ctx.cmdSuggestionsCount > 0) {
          if (key.upArrow) {
            actions.onSetCmdSelected(
              (prev) =>
                (prev - 1 + ctx.cmdSuggestionsCount) % ctx.cmdSuggestionsCount
            );
            return { consumed: true };
          }
          if (key.downArrow) {
            actions.onSetCmdSelected(
              (prev) =>
                (prev + 1) % ctx.cmdSuggestionsCount
            );
            return { consumed: true };
          }
        }

        // History navigation (when no suggestions)
        if (key.upArrow) {
          actions.onHistoryNav(-1);
          return { consumed: true };
        }
        if (key.downArrow) {
          actions.onHistoryNav(1);
          return { consumed: true };
        }

        // Cursor movement
        if (key.leftArrow) {
          actions.onCursorChange((c) => Math.max(0, c - 1));
          return { consumed: true };
        }
        if (key.rightArrow) {
          actions.onCursorChange((c) => c + 1);
          return { consumed: true };
        }

        // Backspace / Delete
        if (key.backspace) {
          actions.onInputEdit({ type: "delete", direction: "back" });
          return { consumed: true };
        }
        if (key.delete) {
          actions.onInputEdit({ type: "delete", direction: "forward" });
          return { consumed: true };
        }

        // Regular character input
        if (!key.ctrl && !key.meta && ch) {
          actions.onInputEdit({ type: "insert", text: ch });
          return { consumed: true };
        }
      }

      return { consumed: false };
    },
    [prefixState, exitPending, cancelExitPending, actions]
  );

      return {
        route,
        prefixHint: prefixState
          ? prefixState === "g"
        ? "g: c=chat p=plan d=diff l=logs r=review a=agents m=model u=checkpoint s=skill y=memory"
        : "b: c=context f=files a=agents m=commands"
      : null,
    exitPending,
    cancelPrefix: useCallback(() => setPrefixState(null), []),
  };
}
