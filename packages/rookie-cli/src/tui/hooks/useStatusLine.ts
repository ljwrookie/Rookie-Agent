// A7: Status Line Hook - Custom shell command output for bottom bar
// Polls a user-defined shell command and displays output in status bar

import { useState, useEffect, useRef, useCallback } from "react";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface UseStatusLineOptions {
  /** Shell command to execute */
  command?: string;
  /** Poll interval in milliseconds (default: 5000ms) */
  interval?: number;
  /** Command timeout in milliseconds (default: 3000ms) */
  timeout?: number;
}

interface UseStatusLineResult {
  /** Current status line output */
  output: string;
  /** Whether command is currently executing */
  isLoading: boolean;
  /** Last error if any */
  error?: string;
  /** Manually refresh the status */
  refresh: () => void;
}

/**
 * A7: Hook to poll a shell command for status line display.
 * Similar to CCB's statusLine feature in settings.json.
 */
export function useStatusLine(options: UseStatusLineOptions = {}): UseStatusLineResult {
  const { command, interval = 5000, timeout = 3000 } = options;
  const [output, setOutput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const abortControllerRef = useRef<AbortController | null>(null);

  const executeCommand = useCallback(async () => {
    if (!command) {
      setOutput("");
      return;
    }

    // Cancel previous execution if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setIsLoading(true);
    setError(undefined);

    try {
      const { stdout } = await execAsync(command, {
        timeout,
        encoding: "utf-8",
      });
      // Trim and limit output length for display
      const trimmed = stdout.trim().slice(0, 50);
      setOutput(trimmed);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Don't show error for empty output or timeout
      if (errMsg.includes("timeout")) {
        setOutput("");
      } else {
        setError(errMsg);
        setOutput("");
      }
    } finally {
      setIsLoading(false);
    }
  }, [command, timeout]);

  // Poll on interval
  useEffect(() => {
    if (!command) {
      setOutput("");
      return;
    }

    // Execute immediately
    executeCommand();

    // Set up polling
    const timer = setInterval(executeCommand, interval);
    return () => {
      clearInterval(timer);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [command, interval, executeCommand]);

  return {
    output,
    isLoading,
    error,
    refresh: executeCommand,
  };
}
