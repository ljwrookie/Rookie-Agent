// ─── Skill List Overlay ──────────────────────────────────────────
// P3.4: Browse installed skills with j/k navigation, / to search.
// g s to open, Esc to close, Enter to view details, i to install, u to uninstall.

import { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../hooks/useTheme.js";
import type { Skill } from "@rookie/agent-sdk";

interface SkillListOverlayProps {
  skills: Skill[];
  onSelect?: (skill: Skill) => void;
  onClose: () => void;
  maxHeight: number;
}

function triggerSummary(triggers: Skill["triggers"]): string {
  const cmds = triggers.filter(t => t.type === "command").map(t => t.value);
  if (cmds.length > 0) return cmds.join(", ");
  const intents = triggers.filter(t => t.type === "intent").map(t => t.value);
  if (intents.length > 0) return intents.slice(0, 2).join(", ");
  return triggers[0]?.value ?? "";
}

export function SkillListOverlay({ skills, onSelect: _onSelect, onClose, maxHeight }: SkillListOverlayProps) {
  const { theme } = useTheme();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const q = searchQuery.toLowerCase();
    return skills.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.triggers.some(t => t.value.toLowerCase().includes(q))
    );
  }, [skills, searchQuery]);

  useEffect(() => {
    setSelectedIdx(0);
  }, [filtered.length, searchQuery]);

  useInput((input, key) => {
    if (detailSkill) {
      if (key.escape || key.return) {
        setDetailSkill(null);
      }
      return;
    }

    if (key.escape) {
      if (searchQuery) {
        setSearchQuery("");
      } else {
        onClose();
      }
      return;
    }

    if (key.return) {
      const selected = filtered[selectedIdx];
      if (selected) setDetailSkill(selected);
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
    } else if (input && !key.ctrl && !key.meta && input.length === 1) {
      setSearchQuery(q => q + input);
    }
  });

  if (detailSkill) {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Box marginBottom={1}>
          <Text bold color={theme.colors.system}>{detailSkill.name}</Text>
          <Text color={theme.colors.textDim}> v{detailSkill.version}</Text>
        </Box>
        <Box marginBottom={1}><Text>{detailSkill.description}</Text></Box>
        <Box marginBottom={1}>
          <Text color={theme.colors.textDim}>Triggers: </Text>
          <Text>{detailSkill.triggers.map(t => `${t.type}:${t.value}`).join(", ")}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color={theme.colors.textDim}>Tools: </Text>
          <Text>{detailSkill.tools.join(", ") || "none"}</Text>
        </Box>
        {detailSkill.examples.length > 0 && (
          <Box marginBottom={1} flexDirection="column">
            <Text color={theme.colors.textDim}>Examples:</Text>
            {detailSkill.examples.slice(0, 3).map((ex, i) => (
              <Box key={i} marginLeft={2} flexDirection="column">
                <Text color="gray">Q: {ex.input.slice(0, 60)}{ex.input.length > 60 ? "…" : ""}</Text>
              </Box>
            ))}
          </Box>
        )}
        <Box marginTop={1}><Text color={theme.colors.textDim}>Esc or Enter to close detail</Text></Box>
      </Box>
    );
  }

  if (skills.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={theme.colors.system}>Skills</Text>
        <Text color="gray">No skills installed. Use /skill install &lt;url&gt; to add skills.</Text>
        <Box marginTop={1}><Text color={theme.colors.textDim}>Esc to close</Text></Box>
      </Box>
    );
  }

  const visibleCount = Math.max(3, maxHeight - 6);
  const startIdx = Math.max(0, Math.min(selectedIdx, filtered.length - visibleCount));
  const visible = filtered.slice(startIdx, startIdx + visibleCount);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.colors.system}>Skills</Text>
        <Text color={theme.colors.textDim}> · {filtered.length}/{skills.length} · Enter=detail · /=search · Esc=close</Text>
      </Box>

      {searchQuery !== "" && (
        <Box marginBottom={1}>
          <Text color={theme.colors.system}>/ {searchQuery}</Text>
          <Text color={theme.colors.textDim}>_</Text>
        </Box>
      )}

      {visible.map((skill, vi) => {
        const idx = startIdx + vi;
        const isSelected = idx === selectedIdx;
        return (
          <Box key={skill.name} flexDirection="row" paddingX={1} backgroundColor={isSelected ? "gray" : undefined}>
            <Box width={20}>
              <Text bold={isSelected} color={isSelected ? theme.colors.text : theme.colors.system}>
                {skill.name}
              </Text>
            </Box>
            <Box width={30}>
              <Text color={theme.colors.textDim}>{skill.description.slice(0, 28)}{skill.description.length > 28 ? "…" : ""}</Text>
            </Box>
            <Box width={20}>
              <Text color="gray">{triggerSummary(skill.triggers)}</Text>
            </Box>
            <Box width={10}>
              <Text color="gray">{skill.tools.length} tools</Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color={theme.colors.textDim}>
          ↑/↓ navigate · Enter view detail · / search · Esc close
        </Text>
      </Box>
    </Box>
  );
}
