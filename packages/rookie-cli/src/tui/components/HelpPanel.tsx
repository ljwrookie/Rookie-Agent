// ─── Help Panel ──────────────────────────────────────────────────
// P1-AR.1: Context-aware help that changes based on current view/focus

import { Box, Text } from "ink";
import type { TuiMode } from "../types.js";
import { useTheme } from "../hooks/useTheme.js";

interface HelpPanelProps {
  currentMode: TuiMode;
  maxHeight: number;
  /** P1-AR.1: Current navigation context for dynamic help */
  primaryView?: string;
  overlay?: string | null;
  sidebar?: string;
  isProcessing?: boolean;
  pendingApprovals?: number;
  pendingQuestions?: number;
  hasAgents?: boolean;
}

interface HelpSection {
  title: string;
  bindings: Array<{ key: string; description: string }>;
}

export function HelpPanel({
  currentMode,
  maxHeight,
  primaryView = "stream",
  overlay = null,
  sidebar = "context",
  isProcessing = false,
  pendingApprovals = 0,
  pendingQuestions = 0,
  hasAgents = false,
}: HelpPanelProps) {
  const { theme } = useTheme();
  const sections = buildHelpSections({
    mode: currentMode,
    primaryView,
    overlay,
    sidebar,
    isProcessing,
    pendingApprovals,
    pendingQuestions,
    hasAgents,
  });
  let lineCount = 0;

  return (
    <Box flexDirection="column" paddingX={2} overflow="hidden">
      <Box marginBottom={1}>
        <Text bold color={theme.colors.system}>Keyboard Shortcuts</Text>
        <Text color={theme.colors.textDim}> (press </Text>
        <Text bold color={theme.colors.system}>?</Text>
        <Text color={theme.colors.textDim}> or </Text>
        <Text bold color={theme.colors.system}>Esc</Text>
        <Text color={theme.colors.textDim}> to close)</Text>
      </Box>

      {/* P1-AR.1: Context banner showing current state */}
      <Box marginBottom={1} flexDirection="row" gap={1}>
        <Text color={theme.colors.textDim}>View:</Text>
        <Text bold color={theme.colors.system}>{primaryView}</Text>
        {overlay && (
          <>
            <Text color={theme.colors.textDim}>+</Text>
            <Text bold color={theme.colors.system}>{overlay}</Text>
          </>
        )}
        {isProcessing && <Text color="yellow">[running]</Text>}
        {pendingApprovals > 0 && <Text color="red">[{pendingApprovals} approval(s)]</Text>}
        {pendingQuestions > 0 && <Text color="cyan">[{pendingQuestions} question(s)]</Text>}
      </Box>

      {sections.map((section) => {
        if (lineCount >= maxHeight - 6) return null;
        lineCount += 1 + section.bindings.length + 1;
        return (
          <Box key={section.title} flexDirection="column" marginBottom={1}>
            <Text bold color={theme.colors.text}>{section.title}</Text>
            {section.bindings.map((b) => (
              <Box key={b.key}>
                <Box width={16}>
                  <Text bold color={theme.colors.system}>{b.key}</Text>
                </Box>
                <Text color={theme.colors.textDim}>{b.description}</Text>
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

interface HelpContext {
  mode: TuiMode;
  primaryView: string;
  overlay: string | null;
  sidebar: string;
  isProcessing: boolean;
  pendingApprovals: number;
  pendingQuestions: number;
  hasAgents: boolean;
}

function buildHelpSections(ctx: HelpContext): HelpSection[] {
  const sections: HelpSection[] = [];

  // ── Global ──
  sections.push({
    title: "Global",
    bindings: [
      { key: "Enter", description: "Send message / Toggle event expand" },
      { key: "Ctrl+C", description: "Interrupt running task / Exit" },
      { key: "Ctrl+L", description: "Clear screen" },
      { key: "Ctrl+H", description: "Toggle help (always)" },
      { key: "Esc", description: "Back to chat / Unfocus / Exit" },
      { key: "Tab", description: "Autocomplete (in input) / Toggle focus (when no suggestions)" },
      { key: "?", description: "Toggle this help panel" },
    ],
  });

  // ── Navigation (P1-AR.1: g-prefix and b-prefix) ──
  sections.push({
    title: "Navigation",
    bindings: [
      { key: "g c", description: "Go to chat stream" },
      { key: "g p", description: "Go to plan view" },
      { key: "g a", description: "Go to agents view" },
      { key: "g d", description: "Open diff overlay" },
      { key: "g l", description: "Open logs overlay" },
      { key: "g r", description: "Open review overlay" },
      { key: "g m", description: "Open model picker" },
      { key: "g u", description: "Open checkpoint history" },
      { key: "g s", description: "Open skills overlay" },
      { key: "g y", description: "Open memory overlay" },
      { key: "b c/f/a/m", description: "Sidebar: context/files/agents/commands" },
      { key: "j / k", description: "Scroll down / up" },
      { key: "PageDown/Up", description: "Scroll 5 events" },
      { key: "G", description: "Jump to latest (auto-follow)" },
      { key: "Space", description: "Toggle event detail" },
    ],
  });

  // ── Input ──
  sections.push({
    title: "Input",
    bindings: [
      { key: "↑ / ↓", description: "Browse input history" },
      { key: "← / →", description: "Move cursor" },
      { key: "/", description: "Start command (shows suggestions)" },
      { key: "Alt+Enter", description: "Insert new line" },
      { key: "r", description: "Retry last message" },
    ],
  });

  // ── Context-aware: Processing state ──
  if (ctx.isProcessing) {
    sections.push({
      title: "Running Task",
      bindings: [
        { key: "Ctrl+C", description: "Interrupt the running agent" },
        { key: "Esc", description: "Unfocus input to navigate events" },
      ],
    });
  }

  // ── Context-aware: Pending approvals ──
  if (ctx.pendingApprovals > 0) {
    sections.push({
      title: "Approval Required",
      bindings: [
        { key: "o", description: "Approve (once)" },
        { key: "s", description: "Approve for session" },
        { key: "f", description: "Approve forever" },
        { key: "x", description: "Reject / Deny" },
      ],
    });
  }

  // ── Context-aware: Pending questions ──
  if (ctx.pendingQuestions > 0) {
    sections.push({
      title: "Question Pending",
      bindings: [
        { key: "Type + Enter", description: "Answer the question" },
        { key: "Esc", description: "Cancel / Skip" },
      ],
    });
  }

  // ── Context-aware: Multi-agent ──
  if (ctx.hasAgents) {
    sections.push({
      title: "Multi-Agent",
      bindings: [
        { key: "g a", description: "View agent panel" },
        { key: "↑/↓", description: "Select agent" },
        { key: "Enter", description: "View agent details" },
      ],
    });
  }

  // ── View-specific ──
  if (ctx.primaryView === "agents") {
    sections.push({
      title: "Agent Panel",
      bindings: [
        { key: "j / k", description: "Select agent" },
        { key: "Enter", description: "View agent details" },
        { key: "q / Esc", description: "Back to chat" },
      ],
    });
  }

  if (ctx.overlay === "diff") {
    sections.push({
      title: "Diff View",
      bindings: [
        { key: "j / k", description: "Scroll diff lines" },
        { key: "Tab", description: "Next file" },
        { key: "Shift+Tab", description: "Previous file" },
        { key: "Esc", description: "Close diff overlay" },
      ],
    });
  }

  if (ctx.overlay === "logs") {
    sections.push({
      title: "Logs View",
      bindings: [
        { key: "j / k", description: "Scroll logs" },
        { key: "Esc", description: "Close logs overlay" },
      ],
    });
  }

  // ── Commands ──
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
