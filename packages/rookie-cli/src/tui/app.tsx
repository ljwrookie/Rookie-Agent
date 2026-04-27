// ─── Redesigned TUI App ──────────────────────────────────────────
// Fixes applied: #1 multi-line response, #2 Ctrl+C interrupt, #3 approval blocking,
// #4 thinking merge, #7 input history, #8 auto-scroll, #9 git branch,
// #10 duration, #13 token display, #15 file tracking, #17 welcome
// TUI-OPT: #2 PageUp/Down, #4 Tab cycle, #7 resize debounce,
// #8 exit confirm, #9 spinner, #10 help panel

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import type { AgentEvent, CommandRegistry, SlashCommandResult } from "@rookie/agent-sdk";
import { createDefaultRegistry } from "@rookie/agent-sdk";

import type { ApprovalAction, RiskLevel } from "./types.js";
import { COLORS } from "./types.js";
import { useTuiState } from "./hooks/useTuiState.js";
import { TopStatusBar } from "./components/TopStatusBar.js";
import { ModeTab } from "./components/ModeTab.js";
import { EventStream } from "./components/EventStream.js";
import { ApprovalPanel } from "./components/ApprovalPanel.js";
import { UserQuestionPanel } from "./components/UserQuestionPanel.js";
import { PlanPanel } from "./components/PlanPanel.js";
import { DiffPanel } from "./components/DiffPanel.js";
import { LogPanel } from "./components/LogPanel.js";
import { ContextPanel } from "./components/ContextPanel.js";
import { ErrorDisplay } from "./components/ErrorDisplay.js";
import { InputPanel } from "./components/InputPanel.js";
import { BottomBar } from "./components/BottomBar.js";
import { HelpPanel } from "./components/HelpPanel.js";
import { CommandSuggestions, type CommandSuggestion } from "./components/CommandSuggestions.js";

// ── Updated props interface (matches index.tsx) ──────────────────
export interface TuiAppProps {
  onMessage: (message: string) => {
    generator: AsyncGenerator<AgentEvent>;
    abort: () => void;
  };
  onApprovalResponse: (allowed: boolean, remember?: "once" | "session" | "forever") => void;
  onInterrupt: () => void;
  /** B10.2: Callback when user answers a question */
  onQuestionResponse?: (answer: string) => void;
  tokenTracker?: {
    getTotalUsage: () => { totalTokens: number };
    getTotalCost: () => number;
  };
  /**
   * Optional slash-command registry (P1-T2). When omitted the TUI falls back
   * to the default set, preserving previous behaviour.
   */
  commands?: CommandRegistry;
  meta: {
    sessionId: string;
    startedAt: number;
    modelName: string;
    mode: "code" | "chat";
    toolNames: string[];
    version?: string;
    gitBranch?: string;
  };
}

const DANGEROUS_TOOLS = new Set(["shell_execute", "file_write", "file_edit"]);
const PAGE_SCROLL_SIZE = 5;

// ── TUI-OPT-7: Debounced window size ────────────────────────────
function useDebouncedWindowSize(delay = 100): { columns: number; rows: number } {
  const raw = useWindowSize();
  const [debounced, setDebounced] = useState(raw);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(raw), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [raw.columns, raw.rows, delay]);

  return debounced;
}

export function App({ onMessage, onApprovalResponse, onInterrupt, onQuestionResponse, tokenTracker, commands, meta }: TuiAppProps) {
  const { exit } = useApp();
  const window = useDebouncedWindowSize();

  // Fallback to the default registry so existing embedders don't have to wire
  // anything — commands wired externally (CLI startup) win by reference.
  const registry = useMemo(() => commands ?? createDefaultRegistry(), [commands]);

  const state = useTuiState({
    modelName: meta.modelName,
    directory: process.cwd(),
    branch: meta.gitBranch,
  });

  const [inputText, setInputText] = useState("");
  const [inputCursor, setInputCursor] = useState(0);
  const [statusText, setStatusText] = useState("Ready");
  const [diffFileIdx, _setDiffFileIdx] = useState(0); void _setDiffFileIdx;
  const [diffScroll, setDiffScroll] = useState(0);
  const [logScroll, setLogScroll] = useState(0);
  const [approvalIdx, setApprovalIdx] = useState(0);
  const [inputFocused, setInputFocused] = useState(true);
  const [cmdSelected, setCmdSelected] = useState(0);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  // A1: Track retry state for stream recovery
  const [isRetrying, setIsRetrying] = useState(false);
  const [historyIdx, setHistoryIdx] = useState(-1);
  // TUI-OPT-10: Help panel toggle
  const [showHelp, setShowHelp] = useState(false);
  // TUI-OPT-8: Exit confirmation state
  const [exitPending, setExitPending] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const autoFollowRef = useRef(true);
  const approvalResolvers = useRef<Map<string, (d: "approved" | "rejected") => void>>(new Map());
  const currentAbortRef = useRef<(() => void) | null>(null);
  const busy = state.isProcessing;
  // Ref to hold handleSubmit to avoid TDZ in recovery useEffect
  const handleSubmitRef = useRef<((text: string) => Promise<void>) | null>(null);

  // #17: Welcome message
  const welcomeSent = useRef(false);
  useEffect(() => {
    if (welcomeSent.current) return;
    welcomeSent.current = true;
    state.addEvent("system",
      `Rookie Agent ${meta.version ? "v" + meta.version : "dev"} — Model: ${meta.modelName}`,
      { severity: "info", collapsed: false });
    state.addEvent("system",
      "Type a message to start, or /help for commands. Press ? for keyboard shortcuts. Alt+Enter for multi-line.",
      { severity: "info", collapsed: false });
  }, []);

  // A1: Setup stream recovery callback
  useEffect(() => {
    state.setRecoveryCallback(() => {
      if (lastMessage && !isRetrying) {
        setIsRetrying(true);
        state.addEvent("system", "🔄 Stream stalled, attempting recovery...", { severity: "warning", collapsed: false });
        // Abort current stream if any
        if (currentAbortRef.current) {
          currentAbortRef.current();
        }
        // Retry after a short delay
        setTimeout(() => {
          if (handleSubmitRef.current) {
            void handleSubmitRef.current(lastMessage);
          }
          setIsRetrying(false);
        }, 500);
      }
    });
    return () => state.setRecoveryCallback(null);
  }, [lastMessage, isRetrying, state]);

  // #8: Auto-scroll
  useEffect(() => {
    if (autoFollowRef.current && state.events.length > 0) {
      state.setSelectedEventIdx(state.events.length - 1);
    }
  }, [state.events.length]);

  const [sessionAge, setSessionAge] = useState("0s");
  useEffect(() => {
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - meta.startedAt) / 1000);
      if (s < 60) setSessionAge(s + "s");
      else if (s < 3600) setSessionAge(Math.floor(s / 60) + "m");
      else setSessionAge(Math.floor(s / 3600) + "h" + Math.floor((s % 3600) / 60) + "m");
    }, 1000);
    return () => clearInterval(t);
  }, [meta.startedAt]);

  // #13: Token usage for BottomBar
  const tokenInfo = useMemo(() => {
    if (!tokenTracker) return { tokensUsed: undefined, costUsd: undefined };
    return {
      tokensUsed: tokenTracker.getTotalUsage().totalTokens,
      costUsd: tokenTracker.getTotalCost(),
    };
  }, [tokenTracker]);

  const cmdSuggestions = useMemo<CommandSuggestion[]>(() => {
    if (!inputText.startsWith("/")) return [];
    const needle = inputText.split(/\s+/)[0] ?? "";
    return registry.filter(needle, 6).map((cmd) => ({
      value: `/${cmd.name}`,
      description: cmd.description,
      usage: cmd.usage,
      paramsHint: cmd.paramsHint,
    }));
  }, [inputText, registry]);

  useEffect(() => { setCmdSelected(0); }, [inputText]);

  const layout = useMemo(() => {
    const cols = Math.max(60, window.columns);
    const rows = Math.max(20, window.rows);
    const inputLines = Math.min(8, inputText.split("\n").length);
    const inputH = 3 + Math.max(0, inputLines - 1); // border*2 + content lines
    const chrome = 1 + 1 + inputH + 1; // top + tabs + input + bottom
    const mainH = Math.max(8, rows - chrome);
    const sidebarW = Math.max(28, Math.min(38, Math.floor(cols * 0.25)));
    const mainW = Math.max(40, cols - sidebarW - 1);
    return { mainH, mainW, sidebarW };
  }, [window.columns, window.rows, inputText]);

  /**
   * Dispatch a `/command` through the registry and apply its result to the
   * TUI. Returns a prompt string if the command wants the agent loop invoked,
   * otherwise null. Async because handlers may be async (e.g. Skill bridge).
   */
  const handleCommand = useCallback(async (raw: string): Promise<string | null> => {
    const result: SlashCommandResult | null = await registry.execute(raw, {
      cwd: process.cwd(),
      meta: { modelName: meta.modelName, mode: state.mode, sessionId: meta.sessionId },
    });
    if (!result) {
      state.addEvent("error", "Unknown command: " + raw, { severity: "error" });
      return null;
    }
    if (result.clear) {
      state.clearScreen();
      setStatusText("Ready");
    }
    if (result.mode) state.setMode(result.mode);
    if (result.showHelp) setShowHelp(true);
    if (result.systemMessage) {
      state.addEvent("system", result.systemMessage, { severity: "info", collapsed: false });
    }
    if (result.prompt) return result.prompt;
    return null;
  }, [meta.modelName, meta.sessionId, registry, state]);

  // ── Updated processEvents: uses {generator, abort} from onMessage ──
  const processEvents = useCallback(async (message: string) => {
    state.setIsProcessing(true);
    setStatusText("Thinking...");
    autoFollowRef.current = true;
    state.addEvent("user", message, { severity: "info", collapsed: true });

    const toolStartTimes = new Map<string, number>();
    let streamRespId: string | null = null;
    let streamThinkId: string | null = null;

    // #2: Get generator + abort handle from the factory
    const { generator, abort } = onMessage(message);
    currentAbortRef.current = abort;

    try {
      for await (const event of generator) {
        // A1: Reset idle timer on any event activity
        state.resetStreamIdleTimer();
        switch (event.type) {
          case "thinking": {
            if (!streamThinkId) {
              streamThinkId = state.addEvent("intent", event.content, { severity: "info", collapsed: true });
            } else {
              state.appendToEvent(streamThinkId, event.content);
            }
            setStatusText("Thinking...");
            break;
          }
          case "tool_call": {
            streamThinkId = null;
            const tn = event.call.name;
            toolStartTimes.set(event.call.id, Date.now());
            if (DANGEROUS_TOOLS.has(tn)) {
              const risk: RiskLevel = tn === "shell_execute" ? "high" : "medium";
              const scope = tn === "shell_execute" ? String(event.call.params.command ?? "") : String(event.call.params.path ?? "");
              state.addApproval({ action: tn as ApprovalAction, scope, riskLevel: risk, description: tn + ": " + truncate(scope, 60), detail: JSON.stringify(event.call.params, null, 2), toolCall: event.call });
            }
            state.addEvent("action", "Calling " + tn, { severity: "info", toolName: tn, detail: JSON.stringify(event.call.params, null, 2), collapsed: true });
            if (tn === "file_write" || tn === "file_edit") {
              const fp = String(event.call.params.path ?? "");
              if (fp) state.addActiveFile(fp);
            }
            if (tn === "file_read") {
              const fp = String(event.call.params.path ?? "");
              if (fp) state.addRecentFile(fp);
            }
            setStatusText("Running " + tn + "...");
            break;
          }
          case "tool_result": {
            const st = toolStartTimes.get(event.result.id);
            const dur = st ? Date.now() - st : undefined;
            const isErr = !!event.result.error;
            state.addEvent("result",
              isErr ? "Error: " + truncate(event.result.error ?? "", 80) : event.result.name + " completed",
              { severity: isErr ? "error" : "success", toolName: event.result.name, detail: event.result.output || event.result.error, collapsed: true, durationMs: dur }
            );
            if (isErr) {
              state.addError({ severity: "error", title: "Tool " + event.result.name + " failed", cause: event.result.error, suggestion: "The agent will attempt to recover automatically.", retryable: true });
            }
            setStatusText("Processing...");
            break;
          }
          case "response": {
            streamThinkId = null;
            if (!streamRespId) {
              streamRespId = state.addEvent("result", event.content, { severity: "success", collapsed: false });
            } else {
              state.appendToEvent(streamRespId, event.content);
            }
            if (event.done) { streamRespId = null; setStatusText("Ready"); }
            else { setStatusText("Streaming..."); }
            break;
          }
          case "error": {
            state.addEvent("error", event.error, { severity: "error", collapsed: false });
            state.addError({ severity: "error", title: "Agent error", cause: event.error, retryable: true });
            setStatusText("Error");
            break;
          }
          case "skill_invoked": {
            state.addEvent("action", "Skill: " + event.skill, { severity: "info", collapsed: true });
            break;
          }
          case "hook_fired": {
            state.addEvent("system", "Hook: " + event.hook, { severity: "info", collapsed: true });
            break;
          }
          case "user_question": {
            streamThinkId = null;
            state.addUserQuestion({
              question: event.question,
              options: event.options,
              defaultValue: event.defaultValue,
              toolCall: { id: event.id, name: "AskUserQuestion", params: {} },
            });
            setStatusText("Waiting for user...");
            break;
          }
          case "user_question_answer": {
            state.addEvent("system", "User answered: " + event.answer, { severity: "info", collapsed: true });
            setStatusText("Processing...");
            break;
          }
        }
      }
    } catch (e) {
      const msg = String(e);
      // #2: Handle abort gracefully
      if (msg.includes("abort") || msg.includes("Abort") || msg.includes("interrupted") || msg.includes("Interrupted")) {
        state.addEvent("system", "Request interrupted by user.", { severity: "warning", collapsed: false });
        setStatusText("Interrupted");
      } else {
        state.addEvent("error", msg, { severity: "error", collapsed: false });
        state.addError({ severity: "error", title: "Unexpected error", cause: msg, retryable: true });
        setStatusText("Error");
      }
    } finally {
      currentAbortRef.current = null;
    }
    state.setIsProcessing(false);
    setStatusText("Ready");
  }, [onMessage, state]);

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    const msg = text.trim();
    setInputText(""); setInputCursor(0); setHistoryIdx(-1);
    state.pushHistory(msg); setLastMessage(msg);
    if (msg.startsWith("/")) {
      const mapped = await handleCommand(msg);
      if (!mapped) return;
      await processEvents(mapped);
    } else {
      await processEvents(msg);
    }
  }, [busy, handleCommand, processEvents, state]);

  // Sync handleSubmit into ref for recovery callback (avoids TDZ)
  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  useInput(useCallback((ch: string, key: any) => {
    // TUI-OPT-8: Ctrl+C — interrupt if processing, else double-tap to exit
    if (key.ctrl && ch === "c") {
      if (busy && currentAbortRef.current) {
        currentAbortRef.current();
        onInterrupt();
        setStatusText("Interrupting...");
        setExitPending(false);
      } else if (exitPending) {
        // Second Ctrl+C within timeout → exit
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        exit();
      } else {
        // First Ctrl+C when idle → show hint, start timeout
        setExitPending(true);
        setStatusText("Press Ctrl+C again to exit");
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        exitTimerRef.current = setTimeout(() => {
          setExitPending(false);
          setStatusText("Ready");
        }, 2000);
      }
      return;
    }

    // Any other key clears exit pending
    if (exitPending) setExitPending(false);

    if (key.ctrl && ch === "l") { state.clearScreen(); return; }

    // TUI-OPT-10: Help panel toggle
    if (ch === "?" && (!inputFocused || busy)) {
      setShowHelp(h => !h);
      return;
    }

    if (key.escape) {
      if (showHelp) { setShowHelp(false); return; }
      if (state.mode !== "chat") { state.setMode("chat"); setInputFocused(true); }
      else if (!inputFocused) { setInputFocused(true); }
      else { exit(); }
      return;
    }

    // When help is shown, only Esc and ? close it
    if (showHelp) return;

    if (inputFocused && !busy) {
      // TUI-OPT-4: Tab cycles through suggestions
      if (key.tab && cmdSuggestions.length > 0) {
        if (key.shift) {
          setCmdSelected(i => (i - 1 + cmdSuggestions.length) % cmdSuggestions.length);
        } else {
          const c = cmdSuggestions[cmdSelected]?.value;
          if (c) { setInputText(c + " "); setInputCursor(c.length + 1); }
        }
        return;
      }
      // TUI-OPT-3: Alt+Enter (meta+return) inserts newline for multi-line input
      if (key.return && key.meta) {
        setInputText(v => {
          const cur = Math.max(0, Math.min(inputCursor, v.length));
          setInputCursor(cur + 1);
          return v.slice(0, cur) + "\n" + v.slice(cur);
        });
        return;
      }
      if (key.return) {
        // B10.2: In question mode, submit answer instead of sending message
        if (state.mode === "question" && onQuestionResponse) {
          const pending = state.userQuestions.filter(q => q.status === "pending");
          if (pending.length > 0 && state.selectedQuestionIdx < pending.length) {
            const question = pending[state.selectedQuestionIdx];
            if (question) {
              const answer = inputText.trim() || question.defaultValue || "";
              state.resolveUserQuestion(question.id, answer);
              onQuestionResponse(answer);
              setInputText("");
              setInputCursor(0);
              // Auto-switch back to chat if no more pending questions
              const remaining = state.userQuestions.filter(q => q.status === "pending").length - 1;
              if (remaining <= 0) {
                state.setMode("chat");
              }
              return;
            }
          }
        }
        const c = cmdSuggestions.length > 0 ? (cmdSuggestions[cmdSelected]?.value ?? inputText) : inputText;
        void handleSubmit(c);
        return;
      }
      if (key.upArrow && cmdSuggestions.length > 0) { setCmdSelected(i => (i - 1 + cmdSuggestions.length) % cmdSuggestions.length); return; }
      if (key.downArrow && cmdSuggestions.length > 0) { setCmdSelected(i => (i + 1) % cmdSuggestions.length); return; }
      if (key.upArrow) {
        const h = state.inputHistory;
        if (h.length > 0) {
          const ni = historyIdx < 0 ? h.length - 1 : Math.max(0, historyIdx - 1);
          setHistoryIdx(ni); const v = h[ni] ?? ""; setInputText(v); setInputCursor(v.length);
        }
        return;
      }
      if (key.downArrow) {
        const h = state.inputHistory;
        if (historyIdx >= 0) {
          const ni = historyIdx + 1;
          if (ni >= h.length) { setHistoryIdx(-1); setInputText(""); setInputCursor(0); }
          else { setHistoryIdx(ni); const v = h[ni] ?? ""; setInputText(v); setInputCursor(v.length); }
        }
        return;
      }
      if (key.backspace) { setInputText(v => { if (inputCursor <= 0) return v; setInputCursor(c => Math.max(0, c - 1)); return v.slice(0, inputCursor - 1) + v.slice(inputCursor); }); return; }
      if (key.delete) { setInputText(v => inputCursor >= v.length ? v : v.slice(0, inputCursor) + v.slice(inputCursor + 1)); return; }
      if (key.leftArrow) { setInputCursor(c => Math.max(0, c - 1)); return; }
      if (key.rightArrow) { setInputCursor(c => Math.min(inputText.length, c + 1)); return; }
      if (!key.ctrl && !key.meta && ch) {
        setInputText(v => { const cur = Math.max(0, Math.min(inputCursor, v.length)); setInputCursor(cur + ch.length); return v.slice(0, cur) + ch + v.slice(cur); });
        return;
      }
    }

    if (!inputFocused || busy) {
      // TUI-OPT-2: PageUp/PageDown support (scroll by PAGE_SCROLL_SIZE)
      if (key.pageDown) {
        autoFollowRef.current = false;
        if (state.mode === "diff") { setDiffScroll(s => s + PAGE_SCROLL_SIZE); return; }
        if (state.mode === "logs") { setLogScroll(s => s + PAGE_SCROLL_SIZE); return; }
        for (let i = 0; i < PAGE_SCROLL_SIZE; i++) state.scrollEvent(1);
        return;
      }
      if (key.pageUp) {
        autoFollowRef.current = false;
        if (state.mode === "diff") { setDiffScroll(s => Math.max(0, s - PAGE_SCROLL_SIZE)); return; }
        if (state.mode === "logs") { setLogScroll(s => Math.max(0, s - PAGE_SCROLL_SIZE)); return; }
        for (let i = 0; i < PAGE_SCROLL_SIZE; i++) state.scrollEvent(-1);
        return;
      }

      if (ch === "j") { autoFollowRef.current = false; if (state.mode === "diff") { setDiffScroll(s => s + 1); return; } if (state.mode === "logs") { setLogScroll(s => s + 1); return; } if (state.mode === "approve") { setApprovalIdx(i => i + 1); return; } state.scrollEvent(1); return; }
      if (ch === "k") { autoFollowRef.current = false; if (state.mode === "diff") { setDiffScroll(s => Math.max(0, s - 1)); return; } if (state.mode === "logs") { setLogScroll(s => Math.max(0, s - 1)); return; } if (state.mode === "approve") { setApprovalIdx(i => Math.max(0, i - 1)); return; } state.scrollEvent(-1); return; }
      if (ch === "G") { autoFollowRef.current = true; state.setSelectedEventIdx(state.events.length - 1); return; }
      if (ch === "d") { state.setMode("diff"); return; }
      if (ch === "l") { state.setMode("logs"); return; }
      // #3 / P0-T4: Approval keys — three-tier remember scope
      //   a / o  → approve once (default)
      //   s      → approve for the remainder of this session
      //   f      → approve forever (written to .rookie/settings.local.json)
      //   x      → reject once
      const resolveApproval = (
        allowed: boolean,
        remember: "once" | "session" | "forever",
      ) => {
        const p = state.approvals.filter(a => a.status === "pending");
        if (p.length === 0 || !p[approvalIdx]) return;
        state.resolveApproval(p[approvalIdx].id, allowed ? "approved" : "rejected");
        onApprovalResponse(allowed, remember);
        const r = approvalResolvers.current.get(p[approvalIdx].id);
        if (r) r(allowed ? "approved" : "rejected");
      };
      if (ch === "a" || ch === "o") { resolveApproval(true, "once"); return; }
      if (ch === "s") { resolveApproval(true, "session"); return; }
      if (ch === "f") { resolveApproval(true, "forever"); return; }
      if (ch === "x") { resolveApproval(false, "once"); return; }
      if (ch === "r" && lastMessage && !busy) { void handleSubmit(lastMessage); return; }
      if (key.return || ch === " ") { const ev = state.events[state.selectedEventIdx]; if (ev) state.toggleEventCollapse(ev.id); return; }
      if (key.tab) { setInputFocused(f => !f); return; }
      if (ch === "1") { state.setMode("chat"); return; }
      if (ch === "2") { state.setMode("plan"); return; }
      if (ch === "3") { state.setMode("diff"); return; }
      if (ch === "4") { state.setMode("logs"); return; }
      if (ch === "5") { state.setMode("review"); return; }
      if (ch === "6") { state.setMode("question"); return; }
    }
  }, [busy, cmdSuggestions, cmdSelected, inputCursor, inputFocused, inputText, state, exit, handleSubmit, lastMessage, approvalIdx, historyIdx, onApprovalResponse, onInterrupt, showHelp, exitPending]));

  const recentErrors = useMemo(() => state.errors.filter(e => Date.now() - e.timestamp < 30000), [state.errors]);
  const inputDisplayWidth = useMemo(() => Math.max(10, layout.mainW - 6), [layout.mainW]);

  const mainContent = useMemo(() => {
    // TUI-OPT-10: Help panel overlay
    if (showHelp) {
      return <HelpPanel currentMode={state.mode} maxHeight={layout.mainH} />;
    }

    switch (state.mode) {
      case "chat":
        return (
          <Box flexDirection="column" flexGrow={1}>
            {recentErrors.length > 0 && <Box marginBottom={1}><ErrorDisplay errors={recentErrors} maxErrors={2} /></Box>}
            {state.approvals.filter(a => a.status === "pending").length > 0 && (
              <Box paddingX={1} marginBottom={1}>
                <Text color={COLORS.warning} bold>{"⚠ " + state.approvals.filter(a => a.status === "pending").length + " pending — "}</Text>
                <Text color={COLORS.textDim}>press </Text><Text bold color={COLORS.system}>a</Text><Text color={COLORS.textDim}> approve or </Text><Text bold color={COLORS.system}>Approve</Text><Text color={COLORS.textDim}> mode</Text>
              </Box>
            )}
            <EventStream events={state.events} selectedIdx={state.selectedEventIdx} maxHeight={layout.mainH - (recentErrors.length > 0 ? 5 : 0)} />
          </Box>
        );
      case "plan": return <PlanPanel plan={state.plan} maxHeight={layout.mainH} />;
      case "diff": return <DiffPanel diffs={state.diffs} selectedFileIdx={diffFileIdx} scrollOffset={diffScroll} maxHeight={layout.mainH} />;
      case "logs": return <LogPanel events={state.events} errors={state.errors} longTasks={state.longTasks} maxHeight={layout.mainH} scrollOffset={logScroll} />;
      case "review": return (<Box flexDirection="column" paddingX={1}><Text bold color={COLORS.system}>Review Mode</Text>{state.errors.length > 0 && <Box marginTop={1}><ErrorDisplay errors={state.errors} maxErrors={5} /></Box>}</Box>);
      case "approve": return <ApprovalPanel approvals={state.approvals} selectedIdx={approvalIdx} maxHeight={layout.mainH} />;
      case "question": return <UserQuestionPanel questions={state.userQuestions} selectedIdx={state.selectedQuestionIdx} maxHeight={layout.mainH} />;
      default: return null;
    }
  }, [showHelp, state.mode, state.events, state.selectedEventIdx, state.approvals, state.plan, state.diffs, state.errors, state.longTasks, recentErrors, layout.mainH, diffFileIdx, diffScroll, logScroll, approvalIdx]);

  return (
    <Box flexDirection="column" height={window.rows}>
      <TopStatusBar status={state.status} mode={state.mode} version={meta.version} isProcessing={busy} />
      <ModeTab current={state.mode} pendingApprovals={state.approvals.filter(a => a.status === "pending").length} diffCount={state.diffs.length} errorCount={state.errors.length} />
      <Box flexGrow={1} flexDirection="row">
        <Box width={layout.mainW} flexDirection="column" overflow="hidden">{mainContent}</Box>
        <Box width={layout.sidebarW} flexDirection="column" borderStyle="single" borderLeft borderTop={false} borderRight={false} borderBottom={false} borderColor={COLORS.border}>
          <Box paddingX={1} flexDirection="column" overflow="hidden">
            <ContextPanel context={state.context} longTasks={state.longTasks} model={meta.modelName} sessionAge={sessionAge} maxHeight={layout.mainH} />
          </Box>
        </Box>
      </Box>
      {cmdSuggestions.length > 0 && <CommandSuggestions items={cmdSuggestions} selectedIndex={cmdSelected} />}
      {/* A4: Plan Mode is read-only, hide input panel */}
      {state.mode !== "plan" && (
        <InputPanel value={inputText} cursor={inputCursor} mode={state.mode} disabled={busy} placeholder={busy ? "Processing... (Ctrl+C to interrupt)" : "Type a message or /command..."} displayWidth={inputDisplayWidth} />
      )}
      {/* A4: Show plan mode indicator when in plan mode */}
      {state.mode === "plan" && (
        <Box paddingX={1} height={3} borderStyle="single" borderColor={COLORS.border}>
          <Text color={COLORS.textDim}>
            📋 Plan Mode (read-only) │ Press <Text bold color={COLORS.system}>1</Text> to return to chat │ <Text bold color={COLORS.system}>j/k</Text> to scroll
          </Text>
        </Box>
      )}
      <BottomBar mode={state.mode} isProcessing={busy} statusText={statusText} tokensUsed={tokenInfo.tokensUsed} costUsd={tokenInfo.costUsd} inputFocused={inputFocused} streamStatus={state.status.streamStatus} />
    </Box>
  );
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}
