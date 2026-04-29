// ─── Frame Throttle Hook ─────────────────────────────────────────
// P4.7: Throttles high-frequency stream events to prevent excessive re-renders.
// Uses requestAnimationFrame-style scheduling with a max batch size.

import { useState, useCallback, useRef, useEffect } from "react";

export interface FrameThrottleOptions {
  /** Target frame rate (fps). Default: 30 */
  targetFps?: number;
  /** Max items to batch per frame. Default: 10 */
  maxBatchSize?: number;
}

export interface FrameThrottleState<T> {
  /** Currently visible items */
  visible: T[];
  /** Total items (including buffered) */
  total: number;
  /** Whether there are pending items being buffered */
  hasPending: boolean;
}

/**
 * Frame throttle hook for high-frequency stream events.
 * Batches rapid updates and flushes them at a target frame rate.
 */
export function useFrameThrottle<T>(options: FrameThrottleOptions = {}) {
  const { targetFps = 30, maxBatchSize = 10 } = options;
  const frameInterval = 1000 / targetFps;

  const [visible, setVisible] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [hasPending, setHasPending] = useState(false);

  const bufferRef = useRef<T[]>([]);
  const pendingFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFlushRef = useRef<number>(0);

  const flush = useCallback(() => {
    pendingFlushRef.current = null;
    lastFlushRef.current = Date.now();

    const batch = bufferRef.current.splice(0, maxBatchSize);
    if (batch.length === 0) {
      setHasPending(false);
      return;
    }

    setVisible(prev => [...prev, ...batch]);
    setTotal(prev => prev + batch.length);
    setHasPending(bufferRef.current.length > 0);

    // Schedule next flush if more items remain
    if (bufferRef.current.length > 0) {
      const elapsed = Date.now() - lastFlushRef.current;
      const delay = Math.max(0, frameInterval - elapsed);
      pendingFlushRef.current = setTimeout(flush, delay);
    }
  }, [frameInterval, maxBatchSize]);

  const push = useCallback((item: T) => {
    bufferRef.current.push(item);
    setHasPending(true);

    if (!pendingFlushRef.current) {
      const elapsed = Date.now() - lastFlushRef.current;
      const delay = Math.max(0, frameInterval - elapsed);
      pendingFlushRef.current = setTimeout(flush, delay);
    }
  }, [frameInterval, flush]);

  const pushBatch = useCallback((items: T[]) => {
    bufferRef.current.push(...items);
    setHasPending(true);

    if (!pendingFlushRef.current) {
      const elapsed = Date.now() - lastFlushRef.current;
      const delay = Math.max(0, frameInterval - elapsed);
      pendingFlushRef.current = setTimeout(flush, delay);
    }
  }, [frameInterval, flush]);

  const clear = useCallback(() => {
    if (pendingFlushRef.current) {
      clearTimeout(pendingFlushRef.current);
      pendingFlushRef.current = null;
    }
    bufferRef.current = [];
    setVisible([]);
    setTotal(0);
    setHasPending(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pendingFlushRef.current) {
        clearTimeout(pendingFlushRef.current);
      }
    };
  }, []);

  return {
    visible,
    total,
    hasPending,
    push,
    pushBatch,
    flush,
    clear,
  };
}

export type FrameThrottleAPI<T> = ReturnType<typeof useFrameThrottle<T>>;
