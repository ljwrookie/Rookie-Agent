// ─── Navigation Hook ─────────────────────────────────────────────
// Semantic view navigation with stack-based history.
// Replaces numeric key mode switching (1-5) with g-prefix navigation.
// Supports overlay views that preserve primary view context.

import { useState, useCallback } from "react";

export type PrimaryView = "stream" | "plan" | "agents";
export type Overlay = "diff" | "logs" | "review" | "approve" | "model" | "checkpoint" | "skill" | "memory" | null;
export type SidebarTab = "context" | "files" | "agents" | "commands";

export interface ViewState {
  primary: PrimaryView;
  overlay: Overlay;
  sidebar: SidebarTab;
}

interface NavigationStackEntry {
  view: ViewState;
  scrollPosition: number;
  selectedEventId?: string;
}

const DEFAULT_VIEW: ViewState = {
  primary: "stream",
  overlay: null,
  sidebar: "context",
};

export interface NavigationHint {
  prefix: string;
  options: string;
}

export function useNavigation(initialView: Partial<ViewState> = {}) {
  const [stack, setStack] = useState<NavigationStackEntry[]>([
    {
      view: { ...DEFAULT_VIEW, ...initialView },
      scrollPosition: 0,
    },
  ]);
  const [pendingPrefix, setPendingPrefix] = useState<string | null>(null);

  const current = stack[stack.length - 1];

  const navigateTo = useCallback((target: Partial<ViewState>) => {
    setStack((prev) => {
      const nextView = { ...prev[prev.length - 1].view, ...target };
      // If target already exists in stack, pop back to it (avoid duplicates)
      const existingIdx = prev.findIndex(
        (e) =>
          e.view.primary === nextView.primary &&
          e.view.overlay === nextView.overlay
      );
      if (existingIdx >= 0 && existingIdx < prev.length - 1) {
        return prev.slice(0, existingIdx + 1);
      }
      return [...prev, { view: nextView, scrollPosition: 0 }];
    });
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const closeOverlay = useCallback(() => {
    setStack((prev) => {
      const top = prev[prev.length - 1];
      if (top.view.overlay) {
        return [
          ...prev.slice(0, -1),
          { ...top, view: { ...top.view, overlay: null } },
        ];
      }
      return prev;
    });
  }, []);

  const handlePrefix = useCallback(
    (ch: string): { consumed: boolean; hint?: NavigationHint } => {
      if (pendingPrefix === null) {
        if (ch === "g") {
          setPendingPrefix("g");
          return {
            consumed: true,
            hint: {
              prefix: "g",
              options: "c=chat p=plan d=diff l=logs r=review a=agents m=model u=undo s=skill y=memory",
            },
          };
        }
        if (ch === "b") {
          setPendingPrefix("b");
          return {
            consumed: true,
            hint: {
              prefix: "b",
              options: "c=context f=files a=agents m=commands",
            },
          };
        }
        return { consumed: false };
      }

      if (pendingPrefix === "g") {
        const map: Record<string, Partial<ViewState>> = {
          c: { primary: "stream", overlay: null },
          p: { primary: "plan" },
          d: { overlay: "diff" },
          l: { overlay: "logs" },
          r: { overlay: "review" },
          a: { primary: "agents" },
          m: { overlay: "model" },
          u: { overlay: "checkpoint" },
          s: { overlay: "skill" },
          y: { overlay: "memory" },
        };
        if (map[ch]) {
          navigateTo(map[ch]);
        }
        setPendingPrefix(null);
        return { consumed: true };
      }

      if (pendingPrefix === "b") {
        const map: Record<string, SidebarTab> = {
          c: "context",
          f: "files",
          a: "agents",
          m: "commands",
        };
        if (map[ch]) {
          navigateTo({ sidebar: map[ch] });
        }
        setPendingPrefix(null);
        return { consumed: true };
      }

      setPendingPrefix(null);
      return { consumed: false };
    },
    [pendingPrefix, navigateTo]
  );

  const cancelPrefix = useCallback(() => {
    setPendingPrefix(null);
  }, []);

  return {
    current: current.view,
    stackDepth: stack.length,
    navigateTo,
    goBack,
    closeOverlay,
    handlePrefix,
    cancelPrefix,
    pendingHint: pendingPrefix
      ? {
          prefix: pendingPrefix,
          options:
            pendingPrefix === "g"
              ? "c=chat p=plan d=diff l=logs r=review a=agents m=model u=undo s=skill y=memory"
              : "c=context f=files a=agents m=commands",
        }
      : null,
  };
}

export type NavigationAPI = ReturnType<typeof useNavigation>;
