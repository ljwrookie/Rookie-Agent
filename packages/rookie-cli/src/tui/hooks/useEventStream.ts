// ─── Event Stream State Hook ─────────────────────────────────────
// Extracted from useTuiState god hook. Manages events, selection, scrolling.

import { useState, useCallback, useRef } from "react";
import type { StreamEvent, EventSeverity, EventLane } from "../types.js";

export function useEventStream() {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [selectedEventIdx, setSelectedEventIdx] = useState(-1);
  const eventIdCounter = useRef(0);

  const genId = useCallback((prefix: string) => {
    eventIdCounter.current += 1;
    return `${prefix}_${Date.now()}_${eventIdCounter.current}`;
  }, []);

  const addEvent = useCallback((
    type: StreamEvent["type"],
    title: string,
    opts?: {
      detail?: string;
      severity?: EventSeverity;
      toolName?: string;
      collapsed?: boolean;
      durationMs?: number;
      lane?: EventLane;
    }
  ): string => {
    const id = genId(type);
    const toolName = opts?.toolName;
    const autoLane: StreamEvent["lane"] = opts?.lane ?? (
      type === "system" ? "system" :
      type === "error" ? "notification" :
      toolName && ["shell_execute", "file_write", "file_edit"].includes(toolName) ? "background" :
      "main"
    );
    const event: StreamEvent = {
      id,
      timestamp: Date.now(),
      type,
      title,
      detail: opts?.detail,
      severity: opts?.severity ?? "info",
      collapsed: opts?.collapsed ?? true,
      toolName: opts?.toolName,
      durationMs: opts?.durationMs,
      lane: autoLane,
    };
    setEvents(prev => [...prev, event]);
    return id;
  }, [genId]);

  const appendToEvent = useCallback((id: string, text: string) => {
    setEvents(prev => prev.map(e =>
      e.id === id ? { ...e, title: e.title + text } : e
    ));
  }, []);

  const toggleEventCollapse = useCallback((id: string) => {
    setEvents(prev => prev.map(e =>
      e.id === id ? { ...e, collapsed: !e.collapsed } : e
    ));
  }, []);

  const scrollEvent = useCallback((direction: 1 | -1) => {
    setSelectedEventIdx(prev => {
      const len = events.length;
      if (len === 0) return -1;
      const next = prev + direction;
      if (next < 0) return 0;
      if (next >= len) return len - 1;
      return next;
    });
  }, [events.length]);

  const clearEvents = useCallback(() => {
    setEvents([]);
    setSelectedEventIdx(-1);
  }, []);

  return {
    events,
    selectedEventIdx,
    setSelectedEventIdx,
    addEvent,
    appendToEvent,
    toggleEventCollapse,
    scrollEvent,
    clearEvents,
  };
}

export type EventStreamAPI = ReturnType<typeof useEventStream>;
