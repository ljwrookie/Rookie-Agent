// ─── Bottom Bar ──────────────────────────────────────────────────
// Contextual help hints based on current mode + processing state
// TUI-OPT-5: Dynamic key hints based on mode and focus
// TUI-OPT-6: Token incremental usage + tokens/sec rate
// TUI-OPT-9: Animated spinner

import { useEffect, useState, useRef } from "react";
import { Box, Text } from "ink";
import type { TuiMode } from "../types.js";
import { useTheme } from "../hooks/useTheme.js";
import { useStatusLine } from "../hooks/useStatusLine.js";

interface BottomBarProps {
  mode: TuiMode;
  isProcessing: boolean;
  statusText: string;
  tokensUsed?: number;
  costUsd?: number;
  inputFocused?: boolean;
  streamStatus?: "idle" | "streaming" | "stalled" | "recovering";
  /** A7: Status line shell command */
  statusLineCommand?: string;
  /** Navigation prefix hint (e.g. "g: c=chat p=plan...") */
  prefixHint?: string | null;
  /** Current overlay name */
  overlay?: string | null;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const MODE_HINTS: Record<string, Record<TuiMode, string>> = {
  focused: {
    chat: "Enter send │ ↑↓ history │ Tab complete │ / commands │ Esc unfocus",
    plan: "Enter send │ ↑↓ history │ Tab complete │ / commands │ Esc back",
    diff: "Enter send │ ↑↓ history │ Tab complete │ / commands │ Esc back",
    logs: "Enter send │ ↑↓ history │ Tab complete │ / commands │ Esc back",
    review: "Enter send │ ↑↓ history │ Tab complete │ / commands │ Esc back",
    approve: "Enter send │ ↑↓ history │ Tab complete │ / commands │ Esc back",
    agents: "Enter send │ ↑↓ history │ Tab complete │ / commands │ Esc back",
    model: "↑/↓ select │ Enter confirm │ Esc close",
    checkpoint: "↑/↓ select │ Enter restore │ Esc close",
    skill: "↑/↓ select │ Enter detail │ / search │ Esc close",
    memory: "↑/↓ select │ / search │ Esc close",
  },
  unfocused: {
    chat: "j/k scroll │ Space toggle │ d diff │ l logs │ G latest │ ? help",
    plan: "j/k scroll │ Enter toggle │ 1 chat │ ? help │ Esc back",
    diff: "j/k scroll │ o approve │ Tab file │ ? help │ Esc back",
    logs: "j/k scroll │ / filter │ ? help │ Esc back",
    review: "j/k nav │ o approve │ x reject │ ? help │ Esc back",
    approve: "o approve │ x reject │ j/k nav │ ? help │ Esc back",
    agents: "j/k scroll │ ? help │ Esc back",
    model: "↑/↓ select │ Enter confirm │ Esc close",
    checkpoint: "↑/↓ select │ Enter restore │ Esc close",
    skill: "↑/↓ select │ Enter detail │ / search │ Esc close",
    memory: "↑/↓ select │ / search │ Esc close",
  },
  processing: {
    chat: "Ctrl+C interrupt │ j/k scroll │ G auto-follow",
    plan: "Ctrl+C interrupt │ j/k scroll",
    diff: "Ctrl+C interrupt │ j/k scroll",
    logs: "Ctrl+C interrupt │ j/k scroll",
    review: "Ctrl+C interrupt",
    approve: "Ctrl+C interrupt │ o approve │ x reject",
    agents: "Ctrl+C interrupt",
    model: "Esc close",
    checkpoint: "Esc close",
    skill: "Esc close",
    memory: "Esc close",
  },
};

export function BottomBar({ mode, isProcessing, statusText, tokensUsed, costUsd, inputFocused = true, streamStatus = "idle", statusLineCommand, prefixHint, overlay }: BottomBarProps) {
  const { theme } = useTheme();
  // A7: Status line hook
  const { output: statusLineOutput } = useStatusLine({
    command: statusLineCommand,
    interval: 5000,
    timeout: 3000,
  });
  const [frame, setFrame] = useState(0);

  // Token rate tracking
  const prevTokensRef = useRef(tokensUsed ?? 0);
  const prevTimeRef = useRef(Date.now());
  const [tokPerSec, setTokPerSec] = useState<number | null>(null);

  useEffect(() => {
    if (!isProcessing) return;
    const t = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, [isProcessing]);

  // Calculate tokens/sec during processing
  useEffect(() => {
    if (!isProcessing || tokensUsed === undefined) {
      setTokPerSec(null);
      return;
    }
    const t = setInterval(() => {
      const now = Date.now();
      const dt = (now - prevTimeRef.current) / 1000;
      const dTokens = (tokensUsed ?? 0) - prevTokensRef.current;
      if (dt > 0.5 && dTokens > 0) {
        setTokPerSec(Math.round(dTokens / dt));
      }
      prevTokensRef.current = tokensUsed ?? 0;
      prevTimeRef.current = now;
    }, 1000);
    return () => clearInterval(t);
  }, [isProcessing, tokensUsed]);

  const spinner = SPINNER_FRAMES[frame] ?? "⠋";
  // A1: Stream stall detection visual indicators
  const indicator = streamStatus === "stalled" ? "⏳" : streamStatus === "recovering" ? "🔄" : isProcessing ? spinner : "●";
  const indicatorColor = streamStatus === "stalled" ? theme.colors.error : streamStatus === "recovering" ? theme.colors.warning : isProcessing ? theme.colors.warning : theme.colors.success;
  const displayStatusText = streamStatus === "stalled" ? "⏳ 等待模型响应..." : streamStatus === "recovering" ? "🔄 正在恢复..." : statusText;

  // Dynamic hints based on state
  const hintKey = isProcessing ? "processing" : (inputFocused ? "focused" : "unfocused");
  const baseHints = MODE_HINTS[hintKey]?.[mode] ?? MODE_HINTS.unfocused[mode];
  const hints = prefixHint ?? (overlay ? `Overlay: ${overlay} | Esc/Ctrl+O to close` : baseHints);

  return (
    <Box paddingX={1} height={1} justifyContent="space-between">
      {/* Left: status */}
      <Box>
        <Text color={indicatorColor}>{indicator}</Text>
        <Text> </Text>
        <Text bold>{displayStatusText}</Text>
      </Box>

      {/* Center: mode-specific hints */}
      <Box>
        <Text color={theme.colors.textDim}>{hints}</Text>
      </Box>

      {/* Right: status line output + tokens/cost/rate */}
      <Box>
        {/* A7: Status line output */}
        {statusLineOutput && (
          <Text color={theme.colors.textDim}>
            {statusLineOutput}
          </Text>
        )}
        {statusLineOutput && (tokensUsed !== undefined || costUsd !== undefined) && (
          <Text color={theme.colors.textDim}> │ </Text>
        )}
        {tokensUsed !== undefined && (
          <Text color={theme.colors.textDim}>
            {tokensUsed.toLocaleString()} tok
          </Text>
        )}
        {tokPerSec !== null && isProcessing && (
          <Text color={theme.colors.textDim}>
            {" "}({tokPerSec}/s)
          </Text>
        )}
        {costUsd !== undefined && (
          <>
            <Text color={theme.colors.textDim}> │ </Text>
            <Text color={theme.colors.textDim}>
              ${costUsd.toFixed(4)}
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
}
