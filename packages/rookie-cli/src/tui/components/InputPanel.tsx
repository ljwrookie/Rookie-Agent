// ─── Input Panel ─────────────────────────────────────────────────
// Command input with mode indicator, history, and completion support
// Uses useCursor for IME candidate window positioning
// TUI-OPT-3: Multi-line input support (Alt+Enter to add newline)

import { useRef, useEffect, useMemo } from "react";
import { Box, Text, useCursor, type DOMElement } from "ink";
import type { TuiMode } from "../types.js";
import { COLORS } from "../types.js";

interface InputPanelProps {
  value: string;
  cursor: number;
  mode: TuiMode;
  disabled: boolean;
  placeholder?: string;
  displayWidth?: number;
}

const MODE_PROMPT: Record<TuiMode, { label: string; color: string }> = {
  chat: { label: "❯", color: COLORS.success },
  plan: { label: "◆", color: COLORS.system },
  diff: { label: "±", color: COLORS.warning },
  logs: { label: "▪", color: COLORS.textDim },
  review: { label: "◎", color: COLORS.toolName },
  approve: { label: "!", color: COLORS.warning },
  agents: { label: "⚡", color: COLORS.system },
  question: { label: "?", color: COLORS.warning },
};

const MAX_INPUT_LINES = 8;
const MIN_INPUT_HEIGHT = 3; // border-top + 1 content line + border-bottom

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// ── Terminal display width ──────────────────────────────────────
// Lightweight CJK-aware string width calculation.

function charWidth(code: number): number {
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3040 && code <= 0x33bf) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97c) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6b) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f000 && code <= 0x1fbff) ||
    (code >= 0x20000 && code <= 0x2ffff) ||
    (code >= 0x30000 && code <= 0x3ffff)
  ) {
    return 2;
  }
  return 1;
}

function terminalWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    w += charWidth(ch.codePointAt(0)!);
  }
  return w;
}

// ── Absolute position from Yoga layout tree ─────────────────────
// Walk up the parentNode chain to sum all ancestor offsets.

function getAbsolutePosition(element: DOMElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: DOMElement | undefined = element;
  while (current) {
    const yoga = current.yogaNode;
    if (yoga) {
      x += yoga.getComputedLeft();
      y += yoga.getComputedTop();
    }
    current = current.parentNode;
  }
  return { x, y };
}

export function InputPanel({ value, cursor, mode, disabled, placeholder, displayWidth = 60 }: InputPanelProps) {
  const prompt = MODE_PROMPT[mode];
  const cur = clamp(cursor, 0, value.length);

  // Split value into lines for multi-line support
  const lines = value.split("\n");
  const lineCount = Math.min(lines.length, MAX_INPUT_LINES);
  const boxHeight = MIN_INPUT_HEIGHT + Math.max(0, lineCount - 1); // grow for extra lines

  // Find which line the cursor is on and the column within that line
  const { cursorLine, cursorCol } = useMemo(() => {
    let remaining = cur;
    for (let i = 0; i < lines.length; i++) {
      if (remaining <= lines[i].length) {
        return { cursorLine: i, cursorCol: remaining };
      }
      remaining -= lines[i].length + 1; // +1 for the \n
    }
    return { cursorLine: lines.length - 1, cursorCol: lines[lines.length - 1].length };
  }, [cur, lines]);

  // For each visible line, compute display slice around cursor
  const visibleLines = useMemo(() => {
    const startLine = Math.max(0, cursorLine - MAX_INPUT_LINES + 1);
    const endLine = Math.min(lines.length, startLine + MAX_INPUT_LINES);
    return lines.slice(startLine, endLine).map((line, idx) => {
      const globalLineIdx = startLine + idx;
      const isCursorLine = globalLineIdx === cursorLine;
      if (isCursorLine) {
        const fit = fitAroundCursor(line, cursorCol, displayWidth);
        return { ...fit, isCursorLine: true, lineIdx: globalLineIdx };
      }
      // Non-cursor lines: just truncate
      const truncated = line.length > displayWidth ? line.slice(0, displayWidth - 1) + "…" : line;
      return { before: truncated, after: "", sliceCursorWidth: 0, isCursorLine: false, lineIdx: globalLineIdx };
    });
  }, [lines, cursorLine, cursorCol, displayWidth]);

  // Compute which visible line has the cursor (relative to visible start)
  const cursorVisibleLineIdx = visibleLines.findIndex(l => l.isCursorLine);
  const cursorLineData = visibleLines[cursorVisibleLineIdx];

  // ── IME cursor positioning ────────────────────────────────────
  const boxRef = useRef<DOMElement>(null!);
  const { setCursorPosition } = useCursor();

  useEffect(() => {
    if (disabled || !boxRef.current || !cursorLineData) {
      setCursorPosition(undefined);
      return;
    }
    const abs = getAbsolutePosition(boxRef.current);

    const borderLeft = 1;
    const paddingLeft = 1;
    const promptDisplayWidth = terminalWidth(prompt.label + " ");
    const cursorX = abs.x + borderLeft + paddingLeft + (cursorVisibleLineIdx === 0 ? promptDisplayWidth : 2 /* indent for continuation */) + cursorLineData.sliceCursorWidth;
    // Content starts at abs.y + 1 (border top), cursor line offset by cursorVisibleLineIdx
    const cursorY = abs.y + 2 + cursorVisibleLineIdx;

    setCursorPosition({ x: cursorX, y: cursorY });
  }, [value, cursor, disabled, cursorLineData?.sliceCursorWidth, cursorVisibleLineIdx, prompt.label, setCursorPosition]);

  const isMultiLine = lines.length > 1;

  return (
    <Box ref={boxRef} borderStyle="round" borderColor={disabled ? COLORS.textDim : COLORS.border} paddingX={1} height={boxHeight} flexDirection="column">
      {value.length > 0 ? (
        visibleLines.map((vl, idx) => (
          <Box key={idx} flexDirection="row">
            {/* Mode indicator on first line, continuation marker on subsequent lines */}
            {idx === 0 ? (
              <Text color={prompt.color} bold>{prompt.label} </Text>
            ) : (
              <Text color={COLORS.textDim}>· </Text>
            )}
            {vl.isCursorLine ? (
              <>
                <Text color={disabled ? COLORS.textDim : COLORS.text} wrap="truncate-end">
                  {vl.before}
                </Text>
                <Text color={disabled ? COLORS.textDim : COLORS.text} wrap="truncate-end">
                  {vl.after}
                </Text>
              </>
            ) : (
              <Text color={disabled ? COLORS.textDim : COLORS.text} wrap="truncate-end">
                {vl.before}{vl.after}
              </Text>
            )}
          </Box>
        ))
      ) : (
        <Box flexDirection="row">
          <Text color={prompt.color} bold>{prompt.label} </Text>
          <Text color={COLORS.textDim} dimColor wrap="truncate-end">
            {placeholder || "Type a message or /command... (Alt+Enter for new line)"}
          </Text>
        </Box>
      )}
      {/* Multi-line indicator */}
      {isMultiLine && lines.length > MAX_INPUT_LINES && (
        <Box justifyContent="flex-end">
          <Text color={COLORS.textDim} dimColor>
            [{cursorLine + 1}/{lines.length}]
          </Text>
        </Box>
      )}
    </Box>
  );
}

function fitAroundCursor(
  value: string,
  cursor: number,
  width: number,
): { before: string; after: string; sliceCursorWidth: number } {
  const len = value.length;
  const cur = clamp(cursor, 0, len);
  const w = Math.max(4, width);

  const maxStart = Math.max(0, len - w);
  const idealStart = cur - Math.floor(w * 0.6);
  const start = clamp(idealStart, 0, maxStart);
  const end = Math.min(len, start + w);

  let slice = value.slice(start, end);
  let sliceCursor = cur - start;

  if (start > 0) {
    slice = `…${slice.slice(1)}`;
    sliceCursor = Math.max(0, sliceCursor - 1);
  }
  if (end < len) {
    slice = `${slice.slice(0, -1)}…`;
  }

  const before = slice.slice(0, sliceCursor);
  const after = slice.slice(sliceCursor);
  const sliceCursorWidth = terminalWidth(before);

  return { before, after, sliceCursorWidth };
}
