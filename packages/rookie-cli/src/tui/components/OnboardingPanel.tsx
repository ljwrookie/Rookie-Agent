// ─── Onboarding Panel ────────────────────────────────────────────
// Welcome screen with ASCII logo, inspired by Claude Code
// Auto-dismisses on any key press or after 30s

import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../hooks/useTheme.js";

interface OnboardingPanelProps {
  onComplete: () => void;
  maxHeight: number;
}

// Rookie Agent ASCII Logo
const LOGO_LINES = [
  "    ██████╗  ██████╗  ██████╗ ██╗  ██╗██╗███████╗",
  "    ██╔══██╗██╔═══██╗██╔═══██╗██║ ██╔╝██║██╔════╝",
  "    ██████╔╝██║   ██║██║   ██║█████╔╝ ██║█████╗  ",
  "    ██╔══██╗██║   ██║██║   ██║██╔═██╗ ██║██╔══╝  ",
  "    ██║  ██║╚██████╔╝╚██████╔╝██║  ██╗██║███████╗",
  "    ╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝╚══════╝",
  "                                                 ",
  "         █████╗  ██████╗ ███████╗███╗   ██╗████████╗",
  "        ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝",
  "        ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ",
  "        ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ",
  "        ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ",
  "        ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ",
];

const TAGLINE = "Your AI coding companion";

export function OnboardingPanel({ onComplete, maxHeight }: OnboardingPanelProps) {
  const { theme } = useTheme();
  const [dismissed, setDismissed] = useState(false);
  const [fadeTick, setFadeTick] = useState(0);

  // Auto-dismiss after 30s
  useEffect(() => {
    if (dismissed) return;
    const timer = setTimeout(() => {
      setDismissed(true);
      onComplete();
    }, 30000);
    return () => clearTimeout(timer);
  }, [dismissed, onComplete]);

  // Subtle pulse animation for hint text
  useEffect(() => {
    if (dismissed) return;
    const interval = setInterval(() => {
      setFadeTick((t) => (t + 1) % 4);
    }, 800);
    return () => clearInterval(interval);
  }, [dismissed]);

  useInput(() => {
    if (!dismissed) {
      setDismissed(true);
      onComplete();
    }
  });

  if (dismissed) return null;

  const hintOpacity = ["dim", "normal", "bright", "normal"][fadeTick] as "dim" | "normal" | "bright";
  const hintColor = hintOpacity === "dim" ? theme.colors.textDim :
    hintOpacity === "bright" ? theme.colors.system : theme.colors.text;

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      paddingX={2}
      paddingY={1}
      width="100%"
      height={Math.min(LOGO_LINES.length + 12, maxHeight)}
    >
      {/* Logo */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color={theme.colors.system}>
            {line}
          </Text>
        ))}
      </Box>

      {/* Tagline */}
      <Box marginBottom={1}>
        <Text color={theme.colors.textDim}>{TAGLINE}</Text>
      </Box>

      {/* Divider */}
      <Box marginBottom={1}>
        <Text color={theme.colors.border}>────────────────────────────────────────</Text>
      </Box>

      {/* Quick start hints */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Text color={theme.colors.text}>
          Type a task and press <Text bold color={theme.colors.success}>Enter</Text> to start
        </Text>
        <Text color={theme.colors.textDim}>
          Try: <Text color="yellow">"Refactor auth.ts"</Text> or <Text color="yellow">"Write tests for utils"</Text>
        </Text>
      </Box>

      {/* Key bindings */}
      <Box flexDirection="column" alignItems="center" marginBottom={1}>
        <Box flexDirection="row" gap={2}>
          <Text color={theme.colors.textDim}>
            <Text bold color={theme.colors.system}>?</Text> Help
          </Text>
          <Text color={theme.colors.textDim}>
            <Text bold color={theme.colors.system}>g</Text> Navigate
          </Text>
          <Text color={theme.colors.textDim}>
            <Text bold color={theme.colors.system}>Ctrl+C</Text> Interrupt
          </Text>
          <Text color={theme.colors.textDim}>
            <Text bold color={theme.colors.system}>Esc</Text> Back
          </Text>
        </Box>
      </Box>

      {/* Press any key hint with pulse */}
      <Box marginTop={1}>
        <Text color={hintColor}>
          {hintOpacity === "bright" ? "▸ Press any key to start" : "  Press any key to start"}
        </Text>
      </Box>
    </Box>
  );
}
