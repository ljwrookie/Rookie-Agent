// ─── ModelPickerOverlay ──────────────────────────────────────────
// P3.1: Model selection overlay — g m to open, Esc to close, j/k to select

import { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../hooks/useTheme.js";
import type { HealthMetrics } from "@rookie/agent-sdk";

interface ModelInfo {
  name: string;
  provider: string;
  capabilities?: {
    streaming?: boolean;
    functionCalling?: boolean;
    vision?: boolean;
    maxTokens?: number;
    contextWindow?: number;
  };
  health?: HealthMetrics;
  isDefault: boolean;
}

interface ModelPickerOverlayProps {
  models: ModelInfo[];
  currentDefault: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  maxHeight: number;
}

function healthIcon(health?: HealthMetrics): string {
  if (!health) return "?";
  if (health.circuitState === "open") return "🔴";
  if (health.circuitState === "half-open") return "🟡";
  if (health.successRate < 0.5) return "🔴";
  if (health.successRate < 0.8 || health.p99Latency > 10000) return "🟡";
  return "🟢";
}

function healthColor(health?: HealthMetrics): string {
  if (!health) return "gray";
  if (health.circuitState === "open") return "red";
  if (health.circuitState === "half-open") return "yellow";
  if (health.successRate < 0.5) return "red";
  if (health.successRate < 0.8 || health.p99Latency > 10000) return "yellow";
  return "green";
}

export function ModelPickerOverlay({ models, currentDefault, onSelect, onClose, maxHeight }: ModelPickerOverlayProps) {
  const { theme } = useTheme();
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Auto-select current default
  useEffect(() => {
    const idx = models.findIndex((m) => m.name === currentDefault);
    if (idx >= 0) setSelectedIdx(idx);
  }, [models, currentDefault]);

  useInput((_input, key) => {
    if (key.escape || key.return) {
      if (key.return) {
        const selected = models[selectedIdx];
        if (selected) onSelect(selected.name);
      }
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIdx((i) => (i <= 0 ? models.length - 1 : i - 1));
    } else if (key.downArrow) {
      setSelectedIdx((i) => (i >= models.length - 1 ? 0 : i + 1));
    }
  });

  if (models.length === 0) {
    return (
      <Box flexDirection="column" padding={1} borderStyle="round" borderColor={theme.colors.system}>
        <Text bold color={theme.colors.system}>Model Picker</Text>
        <Text color="gray">No models registered.</Text>
      </Box>
    );
  }

  const visibleCount = Math.max(3, maxHeight - 6);
  const startIdx = Math.max(0, Math.min(selectedIdx, models.length - visibleCount));
  const visible = models.slice(startIdx, startIdx + visibleCount);

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1} borderStyle="round" borderColor={theme.colors.system} height={Math.min(maxHeight, visibleCount + 6)}>
      <Box marginBottom={1}>
        <Text bold color={theme.colors.system}>Model Picker</Text>
        <Text color={theme.colors.textDim}> · {models.length} model(s) · Enter=select · Esc=close</Text>
      </Box>

      {visible.map((model, vi) => {
        const idx = startIdx + vi;
        const isSelected = idx === selectedIdx;
        const h = model.health;
        return (
          <Box key={model.name} flexDirection="row" paddingX={1} backgroundColor={isSelected ? "gray" : undefined}>
            <Box width={3}>
              <Text color={healthColor(h)}>{healthIcon(h)}</Text>
            </Box>
            <Box width={20}>
              <Text bold={isSelected || model.isDefault} color={model.isDefault ? theme.colors.system : theme.colors.text}>
                {model.name}
                {model.isDefault ? " *" : ""}
              </Text>
            </Box>
            <Box width={12}>
              <Text color="cyan">{model.provider}</Text>
            </Box>
            <Box width={16}>
              <Text color="gray">
                {model.capabilities?.contextWindow ? `${(model.capabilities.contextWindow / 1024).toFixed(0)}k ctx` : ""}
              </Text>
            </Box>
            <Box width={20}>
              {h && h.totalRequests > 0 ? (
                <Text color={healthColor(h)}>
                  {Math.round(h.successRate * 100)}% · {h.averageLatency.toFixed(0)}ms
                </Text>
              ) : (
                <Text color="gray">No data</Text>
              )}
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text color={theme.colors.textDim}>
          ↑/↓ select · Enter confirm · * = default
        </Text>
      </Box>
    </Box>
  );
}
