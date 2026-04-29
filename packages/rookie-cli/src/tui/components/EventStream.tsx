// ─── Event Stream Panel ──────────────────────────────────────────
// Main content area: structured events with intent + action + result
// Progressive disclosure: default collapsed, expand on demand
// #1 fix: LLM response renders multi-line with wrap, not truncated
// TUI-OPT-1: Markdown inline styling (**bold**, `code`, [link](url))
// TUI-OPT-2: Scroll position indicator + PageUp/PageDown
// A6: Multi-lane support for agent-based event display

import React from "react";
import { Box, Text } from "ink";
import type { StreamEvent, EventLane } from "../types.js";
import { useTheme } from "../hooks/useTheme.js";

interface EventStreamProps {
  events: StreamEvent[];
  selectedIdx: number;
  maxHeight: number;
  // A6: Multi-lane configuration
  lane?: EventLane;           // Filter to specific lane
  showLanes?: boolean;        // Show lane headers
  multiLane?: boolean;        // Enable multi-lane layout
}

const TYPE_ICON: Record<string, string> = {
  intent: "◆",
  action: "▸",
  result: "◇",
  error: "✗",
  system: "⊙",
  user: "❯",
};

function useSeverityColor(theme: { colors: Record<string, string> }): Record<string, string> {
  return {
    info: theme.colors.textDim,
    success: theme.colors.success,
    warning: theme.colors.warning,
    error: theme.colors.error,
  };
}

// A6: Lane configuration with colors and labels
function useLaneConfig(theme: { colors: Record<string, string> }): Record<EventLane, { label: string; color: string; borderColor: string }> {
  return {
    main: { label: "MAIN", color: theme.colors.text, borderColor: theme.colors.system },
    system: { label: "SYSTEM", color: theme.colors.textDim, borderColor: "gray" },
    background: { label: "BG", color: theme.colors.warning, borderColor: "yellow" },
    notification: { label: "NOTIFY", color: theme.colors.success, borderColor: "green" },
  };
}

export function EventStream({ events, selectedIdx, maxHeight, lane, showLanes, multiLane }: EventStreamProps) {
  const { theme } = useTheme();
  const LANE_CONFIG = useLaneConfig(theme);
  // A6: Filter events by lane if specified
  const filteredEvents = lane
    ? events.filter(ev => (ev.lane ?? "main") === lane)
    : events;

  if (filteredEvents.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color={theme.colors.textDim}>No events yet. Type a message to begin.</Text>
      </Box>
    );
  }

  // A6: Multi-lane layout mode
  if (multiLane && !lane) {
    return (
      <MultiLaneEventStream
        events={events}
        selectedIdx={selectedIdx}
        maxHeight={maxHeight}
        showLanes={showLanes}
      />
    );
  }

  // Smart windowing: show events around selectedIdx, filling maxHeight
  // Reserve 1 line for scroll indicator if needed
  const windowResult = computeVisibleWindow(filteredEvents, selectedIdx, maxHeight - 1);
  const visibleEvents = windowResult.events;
  const above = windowResult.startIdx;
  const below = filteredEvents.length - 1 - windowResult.endIdx;

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {/* A6: Lane header */}
      {showLanes && lane && (
        <Box marginBottom={1}>
          <Text backgroundColor={LANE_CONFIG[lane].borderColor} color="black" bold>
            {` ${LANE_CONFIG[lane].label} `}
          </Text>
        </Box>
      )}

      {/* Scroll-up indicator */}
      {above > 0 && (
        <Box>
          <Text color={theme.colors.textDim}>↑ {above} event{above > 1 ? "s" : ""} above (k/PageUp)</Text>
        </Box>
      )}

      {visibleEvents.map((ev) => {
        const globalIdx = filteredEvents.indexOf(ev);
        const isSelected = globalIdx === selectedIdx;
        return (
          <EventRow
            key={ev.id}
            event={ev}
            selected={isSelected}
            showLaneIndicator={showLanes && !lane}
          />
        );
      })}

      {/* Scroll-down indicator */}
      {below > 0 && (
        <Box>
          <Text color={theme.colors.textDim}>↓ {below} event{below > 1 ? "s" : ""} below (j/PageDown)</Text>
        </Box>
      )}
    </Box>
  );
}

// A6: Multi-lane layout component
interface MultiLaneEventStreamProps {
  events: StreamEvent[];
  selectedIdx: number;
  maxHeight: number;
  showLanes?: boolean;
}

function MultiLaneEventStream({ events, selectedIdx, maxHeight, showLanes }: MultiLaneEventStreamProps) {
  const { theme } = useTheme();
  const LANE_CONFIG = useLaneConfig(theme);
  // Group events by lane
  const laneEvents: Record<EventLane, StreamEvent[]> = {
    main: [],
    system: [],
    background: [],
    notification: [],
  };

  for (const ev of events) {
    const lane = ev.lane ?? "main";
    laneEvents[lane].push(ev);
  }

  // Calculate heights for each lane
  const laneHeight = Math.floor(maxHeight / 2);

  return (
    <Box flexDirection="column" width="100%">
      {/* Top row: Main + System lanes */}
      <Box height={laneHeight}>
        <Box width="70%" flexDirection="column" borderStyle="single" borderColor={LANE_CONFIG.main.borderColor} paddingX={1}>
          {showLanes && (
            <Text backgroundColor={LANE_CONFIG.main.borderColor} color="black" bold>
              {` ${LANE_CONFIG.main.label} `}
            </Text>
          )}
          <LaneEventList
            events={laneEvents.main}
            selectedIdx={selectedIdx}
            maxHeight={laneHeight - (showLanes ? 1 : 0)}
          />
        </Box>
        <Box width="30%" flexDirection="column" borderStyle="single" borderColor={LANE_CONFIG.system.borderColor} paddingX={1}>
          {showLanes && (
            <Text backgroundColor={LANE_CONFIG.system.borderColor} color="black" bold>
              {` ${LANE_CONFIG.system.label} `}
            </Text>
          )}
          <LaneEventList
            events={laneEvents.system}
            selectedIdx={selectedIdx}
            maxHeight={laneHeight - (showLanes ? 1 : 0)}
          />
        </Box>
      </Box>

      {/* Bottom row: Background + Notification lanes */}
      <Box height={laneHeight}>
        <Box width="50%" flexDirection="column" borderStyle="single" borderColor={LANE_CONFIG.background.borderColor} paddingX={1}>
          {showLanes && (
            <Text backgroundColor={LANE_CONFIG.background.borderColor} color="black" bold>
              {` ${LANE_CONFIG.background.label} `}
            </Text>
          )}
          <LaneEventList
            events={laneEvents.background}
            selectedIdx={selectedIdx}
            maxHeight={laneHeight - (showLanes ? 1 : 0)}
          />
        </Box>
        <Box width="50%" flexDirection="column" borderStyle="single" borderColor={LANE_CONFIG.notification.borderColor} paddingX={1}>
          {showLanes && (
            <Text backgroundColor={LANE_CONFIG.notification.borderColor} color="black" bold>
              {` ${LANE_CONFIG.notification.label} `}
            </Text>
          )}
          <LaneEventList
            events={laneEvents.notification}
            selectedIdx={selectedIdx}
            maxHeight={laneHeight - (showLanes ? 1 : 0)}
          />
        </Box>
      </Box>
    </Box>
  );
}

// A6: Simple lane event list (compact view)
interface LaneEventListProps {
  events: StreamEvent[];
  selectedIdx: number;
  maxHeight: number;
}

function LaneEventList({ events, selectedIdx, maxHeight }: LaneEventListProps) {
  const { theme } = useTheme();
  const SEVERITY_COLOR = useSeverityColor(theme);
  if (events.length === 0) {
    return (
      <Box>
        <Text color={theme.colors.textDim} dimColor>(empty)</Text>
      </Box>
    );
  }

  const windowResult = computeVisibleWindow(events, selectedIdx, maxHeight);
  const visibleEvents = windowResult.events;

  return (
    <Box flexDirection="column" overflow="hidden">
      {visibleEvents.map((ev) => {
        const globalIdx = events.indexOf(ev);
        const isSelected = globalIdx === selectedIdx;
        const icon = TYPE_ICON[ev.type] ?? "·";
        const sevColor = SEVERITY_COLOR[ev.severity] ?? theme.colors.textDim;

        return (
          <Box key={ev.id}>
            <Text color={isSelected ? theme.colors.system : undefined}>
              {isSelected ? "▸" : " "}
            </Text>
            <Text color={sevColor}>{icon} </Text>
            <Text color={ev.severity === "error" ? theme.colors.error : theme.colors.text} wrap="truncate-end">
              {ev.title.slice(0, 40)}{ev.title.length > 40 ? "..." : ""}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

// ── Determine if this event is an LLM response (multi-line rendering) ──
function isLlmResponse(event: StreamEvent): boolean {
  return event.type === "result" && !event.toolName && event.severity === "success";
}

interface EventRowProps {
  event: StreamEvent;
  selected: boolean;
  showLaneIndicator?: boolean;
}

function EventRow({ event, selected, showLaneIndicator }: EventRowProps) {
  const { theme } = useTheme();
  const SEVERITY_COLOR = useSeverityColor(theme);
  const LANE_CONFIG = useLaneConfig(theme);
  const icon = TYPE_ICON[event.type] ?? "·";
  const sevColor = SEVERITY_COLOR[event.severity] ?? theme.colors.textDim;
  const timeStr = fmtTime(event.timestamp);
  const durationStr = event.durationMs ? ` ${fmtDuration(event.durationMs)}` : "";
  const isResponse = isLlmResponse(event);

  return (
    <Box flexDirection="column">
      {/* Header line */}
      <Box>
        {/* Selection indicator */}
        <Text color={selected ? theme.colors.system : undefined}>
          {selected ? "▸" : " "}
        </Text>

        {/* A6: Lane indicator */}
        {showLaneIndicator && event.lane && event.lane !== "main" && (
          <>
            <Text color={LANE_CONFIG[event.lane].borderColor}>
              {LANE_CONFIG[event.lane].label.slice(0, 2)}
            </Text>
            <Text color={theme.colors.textDim}> </Text>
          </>
        )}

        {/* Time */}
        <Text color={theme.colors.textDim}>{timeStr} </Text>

        {/* Type icon */}
        <Text color={sevColor}>{icon} </Text>

        {/* For LLM responses: show a short label on the header line */}
        {isResponse ? (
          <Text color={theme.colors.assistant} bold>Assistant</Text>
        ) : (
          /* Non-response events: title on one line, truncated */
          <Text
            color={event.severity === "error" ? theme.colors.error : theme.colors.text}
            bold={event.type === "intent" || event.type === "error"}
            wrap="truncate-end"
          >
            {event.title}
          </Text>
        )}

        {/* Tool name badge */}
        {event.toolName && (
          <>
            <Text color={theme.colors.textDim}> </Text>
            <Text color={theme.colors.toolName}>[{event.toolName}]</Text>
          </>
        )}

        {/* Duration */}
        {durationStr && (
          <Text color={theme.colors.textDim}>{durationStr}</Text>
        )}

        {/* Collapse indicator */}
        {event.detail && (
          <Text color={theme.colors.textDim}>
            {event.collapsed ? " ▶" : " ▼"}
          </Text>
        )}
      </Box>

      {/* LLM response body: multi-line, wrapped, always visible */}
      {isResponse && event.title && (
        <Box paddingLeft={2} flexDirection="column">
          {renderMarkdownLite(event.title)}
        </Box>
      )}

      {/* Expanded detail (for non-response events) */}
      {!isResponse && !event.collapsed && event.detail && (
        <Box paddingLeft={4} flexDirection="column">
          {event.detail.split("\n").slice(0, 20).map((line, i) => (
            <Text key={i} color={theme.colors.textDim} wrap="truncate-end">
              {line}
            </Text>
          ))}
          {event.detail.split("\n").length > 20 && (
            <Text color={theme.colors.textDim}>... ({event.detail.split("\n").length - 20} more lines)</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Lightweight Markdown renderer for terminal ──────────────────
// Handles: paragraphs, **bold**, `code`, ```code blocks```, - lists,
// numbered lists, [link](url), > blockquotes, --- horizontal rules
function renderMarkdownLite(text: string): React.ReactNode[] {
  const { theme } = useTheme();
  const lines = text.split("\n");
  const nodes: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let codeBlockLang = "";
  let blockIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    // Code block toggle
    if (line.trimStart().startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        nodes.push(
          <Box key={`cb-${blockIdx++}`} flexDirection="column" marginY={0} paddingLeft={1} borderStyle="single" borderColor="gray" borderLeft borderTop={false} borderRight={false} borderBottom={false}>
            {codeBlockLang && (
              <Text color={theme.colors.textDim} dimColor>{codeBlockLang}</Text>
            )}
            {codeBlockLines.map((cl, ci) => {
              // Diff-style coloring
              if (codeBlockLang === "diff") {
                const color = cl.startsWith("+") ? theme.colors.success :
                              cl.startsWith("-") ? theme.colors.error :
                              cl.startsWith("@") ? theme.colors.system : "greenBright";
                return <Text key={ci} color={color} wrap="truncate-end">{cl}</Text>;
              }
              return <Text key={ci} color="greenBright" wrap="truncate-end">{cl}</Text>;
            })}
          </Box>
        );
        codeBlockLines = [];
        codeBlockLang = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Empty line → small gap
    if (line.trim() === "") {
      nodes.push(<Box key={`gap-${i}`} height={1} />);
      continue;
    }

    // Heading: # ## ###
    if (/^#{1,3}\s/.test(line)) {
      const level = (line.match(/^(#+)/)?.[1]?.length ?? 1);
      const content = line.replace(/^#{1,3}\s+/, "");
      nodes.push(
        <Box key={i}>
          <Text bold color={level === 1 ? theme.colors.system : theme.colors.text}>
            {renderInlineElements(content, `h-${i}`)}
          </Text>
        </Box>
      );
      continue;
    }

    // Numbered list: 1. 2. etc.
    if (/^\s*\d+\.\s/.test(line)) {
      const indent = (line.match(/^(\s*)/)?.[1]?.length ?? 0) / 2;
      const numMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
      if (numMatch) {
        nodes.push(
          <Box key={i} paddingLeft={indent}>
            <Text color={theme.colors.textDim}>{numMatch[1]}. </Text>
            <Text color={theme.colors.text} wrap="wrap">{renderInlineElements(numMatch[2] ?? "", `nl-${i}`)}</Text>
          </Box>
        );
        continue;
      }
    }

    // List item: - or *
    if (/^\s*[-*]\s/.test(line)) {
      const indent = (line.match(/^(\s*)/)?.[1]?.length ?? 0) / 2;
      const content = line.replace(/^\s*[-*]\s+/, "");
      nodes.push(
        <Box key={i} paddingLeft={indent}>
          <Text color={theme.colors.textDim}>• </Text>
          <Text color={theme.colors.text} wrap="wrap">{renderInlineElements(content, `li-${i}`)}</Text>
        </Box>
      );
      continue;
    }

    // Blockquote: >
    if (/^\s*>\s?/.test(line)) {
      const content = line.replace(/^\s*>\s?/, "");
      nodes.push(
        <Box key={i} paddingLeft={1} borderStyle="single" borderColor={theme.colors.textDim} borderLeft borderTop={false} borderRight={false} borderBottom={false}>
          <Text color={theme.colors.textDim} italic wrap="wrap">{renderInlineElements(content, `bq-${i}`)}</Text>
        </Box>
      );
      continue;
    }

    // Horizontal rule: --- or *** or ___
    if (/^\s*([-*_]){3,}\s*$/.test(line)) {
      nodes.push(
        <Box key={i}>
          <Text color={theme.colors.textDim}>{"─".repeat(40)}</Text>
        </Box>
      );
      continue;
    }

    // Regular paragraph
    nodes.push(
      <Text key={i} color={theme.colors.text} wrap="wrap">{renderInlineElements(line, `p-${i}`)}</Text>
    );
  }

  // Unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    nodes.push(
      <Box key={`cb-${blockIdx}`} flexDirection="column" paddingLeft={1} borderStyle="single" borderColor="gray" borderLeft borderTop={false} borderRight={false} borderBottom={false}>
        {codeBlockLines.map((cl, ci) => (
          <Text key={ci} color="greenBright" wrap="truncate-end">{cl}</Text>
        ))}
      </Box>
    );
  }

  return nodes;
}

// ── Inline formatting: **bold**, `code`, [link](url), *italic* ──
// Returns React elements for rich terminal rendering
function renderInlineElements(text: string, keyPrefix: string): React.ReactNode {
  const { theme } = useTheme();
  const tokens: React.ReactNode[] = [];
  let remaining = text;
  let keyIdx = 0;

  while (remaining.length > 0) {
    // Find the earliest match among patterns
    type PatternDef = { regex: RegExp; type: string };
    const patterns: PatternDef[] = [
      { regex: /\*\*(.+?)\*\*/, type: "bold" },
      { regex: /`([^`]+)`/, type: "code" },
      { regex: /\[([^\]]+)\]\(([^)]+)\)/, type: "link" },
    ];

    let earliest: { index: number; match: RegExpExecArray; type: string } | null = null;

    for (const p of patterns) {
      const m = p.regex.exec(remaining);
      if (m && (earliest === null || m.index < earliest.index)) {
        earliest = { index: m.index, match: m, type: p.type };
      }
    }

    if (!earliest) {
      // No more patterns — push remaining text
      tokens.push(remaining);
      break;
    }

    // Push text before the match
    if (earliest.index > 0) {
      tokens.push(remaining.slice(0, earliest.index));
    }

    // Push styled element
    const k = `${keyPrefix}-${keyIdx++}`;
    switch (earliest.type) {
      case "bold":
        tokens.push(<Text key={k} bold>{earliest.match[1]}</Text>);
        break;
      case "code":
        tokens.push(<Text key={k} color="greenBright">{`\`${earliest.match[1]}\``}</Text>);
        break;
      case "link":
        tokens.push(<Text key={k} color={theme.colors.link} underline>{earliest.match[1]}</Text>);
        break;
    }

    remaining = remaining.slice(earliest.index + earliest.match[0].length);
  }

  if (tokens.length === 0) return text;
  if (tokens.length === 1 && typeof tokens[0] === "string") return tokens[0];
  return <>{tokens}</>;
}

// ── Windowing ──────────────────────────────────────────────────

function estimateEventLines(ev: StreamEvent): number {
  // LLM response: header (1) + content lines
  if (isLlmResponse(ev) && ev.title) {
    const contentLines = ev.title.split("\n").length;
    return 1 + Math.min(contentLines, 30); // cap at 30 visible lines
  }
  // Collapsed or no detail
  if (ev.collapsed || !ev.detail) return 1;
  // Expanded detail
  return 1 + Math.min(ev.detail.split("\n").length, 21);
}

function computeVisibleWindow(
  events: StreamEvent[],
  selectedIdx: number,
  maxHeight: number,
): { events: StreamEvent[]; startIdx: number; endIdx: number } {
  const lineCount = events.map(estimateEventLines);

  const sel = Math.max(0, Math.min(selectedIdx, events.length - 1));

  let start = sel;
  let end = sel;
  let used = lineCount[sel] ?? 1;

  // Expand downward first, then upward
  while (end < events.length - 1 && used + (lineCount[end + 1] ?? 1) <= maxHeight) {
    end++;
    used += lineCount[end] ?? 1;
  }
  while (start > 0 && used + (lineCount[start - 1] ?? 1) <= maxHeight) {
    start--;
    used += lineCount[start] ?? 1;
  }

  return { events: events.slice(start, end + 1), startIdx: start, endIdx: end };
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
