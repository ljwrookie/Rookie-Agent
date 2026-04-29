// ─── Conversation Domain Hook ────────────────────────────────────
// Events, plan, diffs, errors, input history

import { useState, useCallback } from "react";
import type { PlanState, DiffFile, StructuredError } from "../types.js";
import { useEventStream } from "./useEventStream.js";

export function useConversation() {
  const events = useEventStream();

  const [plan, setPlan] = useState<PlanState | null>(null);
  const [diffs, setDiffs] = useState<DiffFile[]>([]);
  const [errors, setErrors] = useState<StructuredError[]>([]);
  const [inputHistory, setInputHistory] = useState<string[]>([]);

  const eventIdCounter = { current: 0 };
  const genId = useCallback((prefix: string) => {
    eventIdCounter.current += 1;
    return `${prefix}_${Date.now()}_${eventIdCounter.current}`;
  }, []);

  const addError = useCallback((err: Omit<StructuredError, "id" | "timestamp">): string => {
    const id = genId("err");
    setErrors(prev => [...prev, { ...err, id, timestamp: Date.now() }]);
    return id;
  }, [genId]);

  const updatePlan = useCallback((updater: (prev: PlanState | null) => PlanState | null) => {
    setPlan(updater);
  }, []);

  const addDiff = useCallback((diff: DiffFile) => {
    setDiffs(prev => {
      const existing = prev.findIndex(d => d.path === diff.path);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = diff;
        return next;
      }
      return [...prev, diff];
    });
  }, []);

  const clearDiffs = useCallback(() => setDiffs([]), []);

  const pushHistory = useCallback((msg: string) => {
    setInputHistory(prev => [...prev.filter(h => h !== msg), msg].slice(-50));
  }, []);

  const clearScreen = useCallback(() => {
    events.clearEvents();
    setErrors([]);
    events.setSelectedEventIdx(-1);
  }, [events]);

  return {
    // Events (delegated)
    events: events.events,
    selectedEventIdx: events.selectedEventIdx,
    setSelectedEventIdx: events.setSelectedEventIdx,
    addEvent: events.addEvent,
    appendToEvent: events.appendToEvent,
    toggleEventCollapse: events.toggleEventCollapse,
    scrollEvent: events.scrollEvent,
    // Plan
    plan,
    updatePlan,
    // Diffs
    diffs,
    addDiff,
    clearDiffs,
    // Errors
    errors,
    addError,
    // Input history
    inputHistory,
    pushHistory,
    // Clear
    clearScreen,
  };
}
