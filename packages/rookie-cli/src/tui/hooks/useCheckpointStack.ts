// ─── Checkpoint Stack Hook ───────────────────────────────────────
// P3.3: Manages undo/redo stack of file snapshots for the TUI.
// Wraps SDK snapshot APIs with stack semantics (undo pointer).

import { useState, useCallback } from "react";

export interface CheckpointEntry {
  id: string;
  filePath: string;
  timestamp: number;
  label: string;        // e.g. "Before edit foo.ts" or "Auto-save"
  size: number;
}

export interface CheckpointStack {
  entries: CheckpointEntry[];
  pointer: number;      // -1 = nothing to undo, 0 = can undo to entries[0]
}

export function useCheckpointStack() {
  const [stack, setStack] = useState<CheckpointStack>({ entries: [], pointer: -1 });

  const pushCheckpoint = useCallback((entry: CheckpointEntry) => {
    setStack(prev => {
      // Discard redo history when new checkpoint is pushed
      const kept = prev.entries.slice(0, prev.pointer + 1);
      const next = [...kept, entry];
      // Keep max 50 entries
      if (next.length > 50) {
        next.shift();
        return { entries: next, pointer: next.length - 1 };
      }
      return { entries: next, pointer: next.length - 1 };
    });
  }, []);

  const canUndo = stack.pointer >= 0;
  const canRedo = stack.pointer < stack.entries.length - 1;

  const undoTarget = canUndo ? stack.entries[stack.pointer] : undefined;
  const redoTarget = canRedo ? stack.entries[stack.pointer + 1] : undefined;

  const movePointer = useCallback((delta: -1 | 1) => {
    setStack(prev => ({
      ...prev,
      pointer: Math.max(-1, Math.min(prev.entries.length - 1, prev.pointer + delta)),
    }));
  }, []);

  const clear = useCallback(() => {
    setStack({ entries: [], pointer: -1 });
  }, []);

  return {
    entries: stack.entries,
    pointer: stack.pointer,
    canUndo,
    canRedo,
    undoTarget,
    redoTarget,
    pushCheckpoint,
    movePointer,
    clear,
  };
}

export type CheckpointStackAPI = ReturnType<typeof useCheckpointStack>;
