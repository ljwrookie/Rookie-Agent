// ─── Stream Lifecycle Hook ───────────────────────────────────────
// Extracted from useTuiState god hook. Manages idle detection + recovery.

import { useState, useCallback, useRef, useEffect } from "react";

const STALL_THRESHOLD_MS = parseInt(process.env.ROOKIE_STALL_THRESHOLD_MS || "30000", 10);
const STREAM_IDLE_TIMEOUT_MS = parseInt(process.env.ROOKIE_STREAM_IDLE_TIMEOUT_MS || "90000", 10);
const MAX_RETRIES = 2;

export function useStreamLifecycle() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamStatus, setStreamStatus] = useState<"idle" | "streaming" | "stalled" | "recovering">("idle");
  const streamIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(Date.now());
  const retryCountRef = useRef<number>(0);
  const onRecoveryRef = useRef<(() => void) | null>(null);

  const setRecoveryCallback = useCallback((cb: (() => void) | null) => {
    onRecoveryRef.current = cb;
  }, []);

  const clearStreamIdleTimer = useCallback(() => {
    if (streamIdleTimerRef.current) {
      clearTimeout(streamIdleTimerRef.current);
      streamIdleTimerRef.current = null;
    }
  }, []);

  const resetStreamIdleTimer = useCallback(() => {
    clearStreamIdleTimer();
    lastActivityRef.current = Date.now();

    if (!isProcessing || streamStatus === "stalled") return;

    streamIdleTimerRef.current = setTimeout(() => {
      const idleTime = Date.now() - lastActivityRef.current;
      if (idleTime >= STALL_THRESHOLD_MS && isProcessing) {
        setStreamStatus("stalled");
      }

      streamIdleTimerRef.current = setTimeout(() => {
        const totalIdleTime = Date.now() - lastActivityRef.current;
        if (totalIdleTime >= STREAM_IDLE_TIMEOUT_MS && isProcessing) {
          if (retryCountRef.current < MAX_RETRIES) {
            retryCountRef.current++;
            setStreamStatus("recovering");
            if (onRecoveryRef.current) {
              onRecoveryRef.current();
            }
          } else {
            setIsProcessing(false);
            setStreamStatus("idle");
          }
        }
      }, STREAM_IDLE_TIMEOUT_MS - STALL_THRESHOLD_MS);
    }, STALL_THRESHOLD_MS);
  }, [isProcessing, streamStatus, clearStreamIdleTimer]);

  useEffect(() => {
    if (isProcessing) {
      retryCountRef.current = 0;
      setStreamStatus("streaming");
      resetStreamIdleTimer();
    } else {
      clearStreamIdleTimer();
      setStreamStatus("idle");
    }
    return () => clearStreamIdleTimer();
  }, [isProcessing, clearStreamIdleTimer, resetStreamIdleTimer]);

  return {
    isProcessing,
    setIsProcessing,
    streamStatus,
    resetStreamIdleTimer,
    setRecoveryCallback,
  };
}

export type StreamLifecycleAPI = ReturnType<typeof useStreamLifecycle>;
