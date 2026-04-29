// ─── Memory Browser Overlay ──────────────────────────────────────
// P3.6: Browse curated memories with search and filter by type.
// g m (memory) to open, Esc to close, / to search, t to filter type.

import { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../hooks/useTheme.js";
import type { CuratedMemory } from "@rookie/agent-sdk";

interface MemoryBrowserOverlayProps {
  memories: CuratedMemory[];
  onClose: () => void;
  maxHeight: number;
}

const TYPE_ICONS: Record<CuratedMemory["type"], string> = {
  fact: "📋",
  preference: "⭐",
  decision: "⚡",
  pattern: "🔁",
  debug_tip: "🐛",
  build_command: "🔨",
  env_issue: "🌐",
  api_pattern: "🔌",
  convention: "📐",
};

const TYPE_COLORS: Record<CuratedMemory["type"], string> = {
  fact: "cyan",
  preference: "yellow",
  decision: "magenta",
  pattern: "blue",
  debug_tip: "red",
  build_command: "green",
  env_issue: "gray",
  api_pattern: "cyanBright",
  convention: "white",
};

function formatRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function MemoryBrowserOverlay({ memories, onClose, maxHeight }: MemoryBrowserOverlayProps) {
  const { theme } = useTheme();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<CuratedMemory["type"] | null>(null);

  const filtered = useMemo(() => {
    let result = memories;
    if (typeFilter) {
      result = result.filter(m => m.type === typeFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(m =>
        m.content.toLowerCase().includes(q) ||
        m.source.toLowerCase().includes(q)
      );
    }
    return result;
  }, [memories, typeFilter, searchQuery]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [filtered.length, searchQuery, typeFilter]);

  useInput((input, key) => {
    if (key.escape) {
      if (searchQuery) { setSearchQuery(""); return; }
      if (typeFilter) { setTypeFilter(null); return; }
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIdx(i => (i <= 0 ? filtered.length - 1 : i - 1));
    } else if (key.downArrow) {
      setSelectedIdx(i => (i >= filtered.length - 1 ? 0 : i + 1));
    } else if (input === "/" && !searchQuery) {
      setSearchQuery("");
    } else if (key.backspace || key.delete) {
      setSearchQuery(q => q.slice(0, -1));
    } else if (input && !key.ctrl && !key.meta && input.length === 1 && input !== "/") {
      setSearchQuery(q => q + input);
    }
  });

  if (memories.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={theme.colors.system}>Memory Browser</Text>
        <Text color="gray">No curated memories yet. Memories are created automatically during sessions.</Text>
        <Box marginTop={1}><Text color={theme.colors.textDim}>Esc to close</Text></Box>
      </Box>
    );
  }

  const visibleCount = Math.max(3, maxHeight - 7);
  const startIdx = Math.max(0, Math.min(selectedIdx, filtered.length - visibleCount));
  const visible = filtered.slice(startIdx, startIdx + visibleCount);
  const selected = filtered[selectedIdx];

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.colors.system}>Memory Browser</Text>
        <Text color={theme.colors.textDim}> · {filtered.length}/{memories.length} · /=search · Esc=close</Text>
      </Box>

      {typeFilter && (
        <Box marginBottom={1}>
          <Text color={theme.colors.system}>Filter: {TYPE_ICONS[typeFilter]} {typeFilter}</Text>
          <Text color={theme.colors.textDim}> · Press Esc to clear</Text>
        </Box>
      )}

      {searchQuery !== "" && (
        <Box marginBottom={1}>
          <Text color={theme.colors.system}>/ {searchQuery}</Text>
          <Text color={theme.colors.textDim}>_</Text>
        </Box>
      )}

      {visible.map((memory, vi) => {
        const idx = startIdx + vi;
        const isSelected = idx === selectedIdx;
        return (
          <Box key={memory.id} flexDirection="row" paddingX={1} backgroundColor={isSelected ? "gray" : undefined}>
            <Box width={3}>
              <Text>{TYPE_ICONS[memory.type]}</Text>
            </Box>
            <Box width={12}>
              <Text color={TYPE_COLORS[memory.type]}>{memory.type}</Text>
            </Box>
            <Box width={8}>
              <Text color="gray">{formatRelative(memory.createdAt)}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text bold={isSelected} color={isSelected ? theme.colors.text : theme.colors.textDim}>
                {memory.content.slice(0, 50)}{memory.content.length > 50 ? "…" : ""}
              </Text>
            </Box>
            <Box width={8}>
              <Text color="gray">{Math.round(memory.confidence * 100)}%</Text>
            </Box>
          </Box>
        );
      })}

      {selected && (
        <Box marginTop={1} paddingX={1} borderStyle="single" borderColor={theme.colors.border}>
          <Text color={theme.colors.textDim}>Source: {selected.source}</Text>
          <Text color={theme.colors.text}>{selected.content}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={theme.colors.textDim}>
          ↑/↓ navigate · / search · Esc back/close
        </Text>
      </Box>
    </Box>
  );
}
