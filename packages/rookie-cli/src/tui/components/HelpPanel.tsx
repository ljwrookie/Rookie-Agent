// ─── Help Panel ──────────────────────────────────────────────────
// TUI-OPT-10: Keyboard shortcut help overlay (? key to toggle)

import { Box, Text } from "ink";
import type { TuiMode } from "../types.js";
import { COLORS, KEY_BINDINGS } from "../types.js";

interface HelpPanelProps {
  currentMode: TuiMode;
  maxHeight: number;
}

interface HelpSection {
  title: string;
  bindings: Array<{ key: string; description: string }>;
}

export function HelpPanel({ currentMode, maxHeight }: HelpPanelProps) {
  const sections = buildHelpSections(currentMode);
  let lineCount = 0;

  return (
    <Box flexDirection="column" paddingX={2} overflow="hidden">
      <Box marginBottom={1}>
        <Text bold color={COLORS.system}>⌨ Keyboard Shortcuts</Text>
        <Text color={COLORS.textDim}> (press </Text>
        <Text bold color={COLORS.system}>?</Text>
        <Text color={COLORS.textDim}> or </Text>
        <Text bold color={COLORS.system}>Esc</Text>
        <Text color={COLORS.textDim}> to close)</Text>
      </Box>

      {sections.map((section) => {
        if (lineCount >= maxHeight - 4) return null;
        lineCount += 1 + section.bindings.length + 1;
        return (
          <Box key={section.title} flexDirection="column" marginBottom={1}>
            <Text bold color={COLORS.text}>{section.title}</Text>
            {section.bindings.map((b) => (
              <Box key={b.key}>
                <Box width={16}>
                  <Text bold color={COLORS.system}>{b.key}</Text>
                </Box>
                <Text color={COLORS.textDim}>{b.description}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

function buildHelpSections(mode: TuiMode): HelpSection[] {
  const sections: HelpSection[] = [];

  // Global
  sections.push({
    title: "Global",
    bindings: [
      { key: "Enter", description: "Send message / Toggle event expand" },
      { key: "Ctrl+C", description: "Interrupt running task / Exit" },
      { key: "Ctrl+L", description: "Clear screen" },
      { key: "Esc", description: "Back to chat / Unfocus / Exit" },
      { key: "Tab", description: "Toggle input focus / Autocomplete" },
      { key: "?", description: "Toggle this help panel" },
      { key: "1-5", description: "Switch mode (Chat/Plan/Diff/Logs/Review)" },
    ],
  });

  // Navigation
  sections.push({
    title: "Navigation",
    bindings: [
      { key: "j / ↓", description: "Scroll down / Next item" },
      { key: "k / ↑", description: "Scroll up / Previous item" },
      { key: "PageDown", description: "Scroll down 5 events" },
      { key: "PageUp", description: "Scroll up 5 events" },
      { key: "G", description: "Jump to latest (auto-follow)" },
      { key: "Space", description: "Toggle event detail" },
    ],
  });

  // Input
  sections.push({
    title: "Input",
    bindings: [
      { key: "↑ / ↓", description: "Browse input history" },
      { key: "← / →", description: "Move cursor" },
      { key: "/", description: "Start command (shows suggestions)" },
      { key: "Alt+Enter", description: "Insert new line (multi-line input)" },
      { key: "r", description: "Retry last message" },
    ],
  });

  // Mode-specific
  if (mode === "approve" || mode === "chat") {
    sections.push({
      title: "Approval",
      bindings: [
        { key: "a", description: "Approve selected item" },
        { key: "x", description: "Reject selected item" },
      ],
    });
  }

  if (mode === "diff") {
    sections.push({
      title: "Diff View",
      bindings: [
        { key: "j / k", description: "Scroll diff lines" },
        { key: "a", description: "Approve hunk" },
        { key: "Tab", description: "Next file" },
      ],
    });
  }

  // Commands
  sections.push({
    title: "Commands",
    bindings: [
      { key: "/help", description: "Show all commands" },
      { key: "/clear", description: "Clear event stream" },
      { key: "/diff", description: "Switch to diff view" },
      { key: "/logs", description: "Switch to logs view" },
      { key: "/plan", description: "Switch to plan view" },
      { key: "/commit", description: "Prepare commit message" },
      { key: "/tests", description: "Run project tests" },
    ],
  });

  return sections;
}
