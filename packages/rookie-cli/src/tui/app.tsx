// ─── Redesigned TUI App v2 ───────────────────────────────────────
// Architecture: Navigation Stack + Overlay + Semantic Keyboard Routing
// Fixes: #2 Ctrl+C interrupt, #3 approval blocking, #4 thinking merge,
//        #7 input history, #8 auto-scroll, #9 git branch,
//        #10 duration, #13 token display, #15 file tracking, #17 welcome
//        #3 useInput 142-line callback → useKeyboardRouter
//        #2 useTuiState god hook → domain slices

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import type { AgentEvent, OrchestratorEvent, CommandRegistry, SlashCommandResult } from "@rookie/agent-sdk";
import { createDefaultRegistry, TranscriptManager } from "@rookie/agent-sdk";

import type { TuiMode } from "./types.js";
import { useTheme } from "./hooks/useTheme.js";
import { useTuiState } from "./hooks/useTuiState.js";
import { useNavigation } from "./hooks/useNavigation.js";
import { useKeyboardRouter } from "./hooks/useKeyboardRouter.js";
import { TopStatusBar } from "./components/TopStatusBar.js";
import { EventStream } from "./components/EventStream.js";
import { ApprovalPanel } from "./components/ApprovalPanel.js";
import { PlanPanel } from "./components/PlanPanel.js";
import { DiffPanel } from "./components/DiffPanel.js";
import { LogPanel } from "./components/LogPanel.js";
import { ContextPanel } from "./components/ContextPanel.js";
import { ErrorDisplay } from "./components/ErrorDisplay.js";
import { InputPanel } from "./components/InputPanel.js";
import { BottomBar } from "./components/BottomBar.js";
import { HelpPanel } from "./components/HelpPanel.js";
import { OnboardingPanel } from "./components/OnboardingPanel.js";
import { CommandSuggestions, type CommandSuggestion } from "./components/CommandSuggestions.js";
import { AgentPanel } from "./components/AgentPanel.js";
import { InteractionCard } from "./components/InteractionCard.js";
import { ModelPickerOverlay } from "./components/ModelPickerOverlay.js";
import { CheckpointStackPanel } from "./components/CheckpointStackPanel.js";
import { SkillListOverlay } from "./components/SkillListOverlay.js";
import { SkillLearnerToast } from "./components/SkillLearnerToast.js";
import { MemoryBrowserOverlay } from "./components/MemoryBrowserOverlay.js";
import { dispatchAgentEvent, dispatchOrchestratorEvent } from "./dispatcher/eventMap.js";

export interface TuiAppProps {
  onMessage: (message: string) => {
    generator: AsyncGenerator<AgentEvent | OrchestratorEvent>;
    abort: () => void;
  };
  onApprovalResponse: (allowed: boolean, remember?: "once" | "session" | "forever") => void;
  onInterrupt: () => void;
  onQuestionResponse?: (answer: string) => void;
  tokenTracker?: {
    getTotalUsage: () => { totalTokens: number };
    getTotalCost: () => number;
  };
  commands?: CommandRegistry;
  /** P3.1: ModelRouter for model picker overlay */
  modelRouter?: {
    listProviders: () => string[];
    getProvider: (name: string) => { name: string; provider?: string; capabilities?: { streaming?: boolean; functionCalling?: boolean; vision?: boolean; maxTokens?: number; contextWindow?: number } } | undefined;
    getHealthMetrics: () => Map<string, import("@rookie/agent-sdk").HealthMetrics>;
    setDefault: (name: string) => void;
    getDefault: () => { name: string };
  };
  /** P4.9: MemoryStore for memory browser overlay */
  memoryStore?: {
    searchCurated: (query: string, limit: number) => Promise<import("@rookie/agent-sdk").CuratedMemory[]>;
    getCuratedByType: (type: import("@rookie/agent-sdk").CuratedMemory["type"], limit: number) => Promise<import("@rookie/agent-sdk").CuratedMemory[]>;
    getRecentForSession: (sessionId: string, limit: number) => Promise<import("@rookie/agent-sdk").CuratedMemory[]>;
  };
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

const PAGE_SCROLL_SIZE = 5;

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

// FIX #7: Session age computed in layout, not state
function useSessionAge(startedAt: number): string {
  const [age, setAge] = useState("0s");
  useEffect(() => {
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      if (s < 60) setAge(s + "s");
      else if (s < 3600) setAge(Math.floor(s / 60) + "m");
      else setAge(Math.floor(s / 3600) + "h" + Math.floor((s % 3600) / 60) + "m");
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return age;
}

export function App({ onMessage, onApprovalResponse, onInterrupt, onQuestionResponse, tokenTracker, commands, modelRouter, memoryStore, meta }: TuiAppProps) {
  const { theme, setTheme } = useTheme();
  const { exit } = useApp();
  const window = useDebouncedWindowSize();
  const registry = useMemo(() => commands ?? createDefaultRegistry(), [commands]);
  const sessionAge = useSessionAge(meta.startedAt);

  // P4.1: Transcript manager for session persistence
  const transcriptRef = useRef<TranscriptManager | null>(null);

  // ── Domain State (from useTuiState god hook - will be split later) ──
  const state = useTuiState(
    {
      modelName: meta.modelName,
      directory: process.cwd(),
      branch: meta.gitBranch,
    },
    {
      tokenTracker,
      modelRouter,
    }
  );

  // ── Navigation (new) ──
  const nav = useNavigation();

  // ── Input State ──
  const [inputText, setInputText] = useState("");
  const [inputCursor, setInputCursor] = useState(0);
  const [inputFocused, setInputFocused] = useState(true);
  const [historyIdx, setHistoryIdx] = useState(-1);

  // ── Scroll State ──
  const [diffScroll, setDiffScroll] = useState(0);
  const [logScroll, setLogScroll] = useState(0);
  const [approvalIdx, setApprovalIdx] = useState(0);
  const [diffFileIdx, setDiffFileIdx] = useState(0);

  // ── UI State ──
  const [statusText, setStatusText] = useState("Ready");
  const [showHelp, setShowHelp] = useState(false);
  const [cmdSelected, setCmdSelected] = useState(0);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    // Show onboarding on first launch (no previous session detected)
    try {
      const skip = process.env.ROOKIE_SKIP_ONBOARDING;
      if (skip === "1" || skip === "true") return false;
    } catch { /* ignore */ }
    return true;
  });
  // P3.5: Skill learner toast state
  const [skillCandidates, setSkillCandidates] = useState<Array<{ name: string; description: string; tools: string[] }> | null>(null);
  // P4.9: Memory browser state
  const [memories, setMemories] = useState<import("@rookie/agent-sdk").CuratedMemory[]>([]);
  const [memoriesLoaded, setMemoriesLoaded] = useState(false);

  const autoFollowRef = useRef(true);
  const lastUserScrollAt = useRef(0);
  const SCROLL_LOCK_MS = 500;
  const currentAbortRef = useRef<(() => void) | null>(null);
  const busy = state.isProcessing;
  const handleSubmitRef = useRef<((text: string) => Promise<void>) | null>(null);

  // Map navigation view to legacy mode for components still using TuiMode
  const legacyMode: TuiMode = useMemo(() => {
    if (nav.current.overlay) return nav.current.overlay;
    if (nav.current.primary === "stream") return "chat";
    if (nav.current.primary === "plan") return "plan";
    if (nav.current.primary === "agents") return "agents";
    return "chat";
  }, [nav.current]);

  // P4.1: Initialize transcript manager on mount
  useEffect(() => {
    const initTranscript = async () => {
      const { initTranscriptManager } = await import("@rookie/agent-sdk");
      const manager = await initTranscriptManager({
        sessionId: meta.sessionId,
        projectRoot: process.cwd(),
      });
      transcriptRef.current = manager;
    };
    void initTranscript();

    return () => {
      // Flush transcript on unmount
      if (transcriptRef.current) {
        void transcriptRef.current.close();
      }
    };
  }, [meta.sessionId]);

  // P4.9: Load memories when memory overlay is opened
  useEffect(() => {
    if (nav.current.overlay === "memory" && memoryStore && !memoriesLoaded) {
      const loadMemories = async () => {
        try {
          const recent = await memoryStore.getRecentForSession(meta.sessionId, 50);
          setMemories(recent);
          setMemoriesLoaded(true);
        } catch {
          setMemories([]);
          setMemoriesLoaded(true);
        }
      };
      void loadMemories();
    }
  }, [nav.current.overlay, memoryStore, meta.sessionId, memoriesLoaded]);

  // #17: Welcome message
  const welcomeSent = useRef(false);
  useEffect(() => {
    if (welcomeSent.current) return;
    welcomeSent.current = true;
    state.addEvent("system",
      `Rookie Agent ${meta.version ? "v" + meta.version : "dev"} — Model: ${meta.modelName}`,
      { severity: "info", collapsed: false });
    state.addEvent("system",
      "Type a message to start, or /help for commands. Press ? for keyboard shortcuts. g=navigate b=sidebar",
      { severity: "info", collapsed: false });
  }, []);

  // A1: Stream recovery
  useEffect(() => {
    state.setRecoveryCallback(() => {
      if (lastMessage && !isRetrying) {
        setIsRetrying(true);
        state.addEvent("system", "Stream stalled, attempting recovery...", { severity: "warning", collapsed: false });
        if (currentAbortRef.current) currentAbortRef.current();
        setTimeout(() => {
          if (handleSubmitRef.current) void handleSubmitRef.current(lastMessage);
          setIsRetrying(false);
        }, 500);
      }
    });
    return () => state.setRecoveryCallback(null);
  }, [lastMessage, isRetrying, state]);

  // #8: Auto-scroll (with scroll-lock debounce)
  useEffect(() => {
    if (autoFollowRef.current && Date.now() - lastUserScrollAt.current > SCROLL_LOCK_MS && state.events.length > 0) {
      state.setSelectedEventIdx(state.events.length - 1);
    }
  }, [state.events.length]);

  // Token usage
  const tokenInfo = useMemo(() => {
    if (!tokenTracker) return { tokensUsed: undefined, costUsd: undefined };
    return {
      tokensUsed: tokenTracker.getTotalUsage().totalTokens,
      costUsd: tokenTracker.getTotalCost(),
    };
  }, [tokenTracker]);

  // Command suggestions
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

  // Keep diff file selection in range
  useEffect(() => {
    const max = Math.max(0, state.diffs.length - 1);
    setDiffFileIdx((i) => Math.max(0, Math.min(i, max)));
  }, [state.diffs.length]);

  // Layout
  const layout = useMemo(() => {
    const cols = Math.max(60, window.columns);
    const rows = Math.max(20, window.rows);
    const inputLines = Math.min(8, inputText.split("\n").length);
    const inputH = 3 + Math.max(0, inputLines - 1);
    const chrome = 1 + inputH + 1; // top + input + bottom (removed mode tab)
    const mainH = Math.max(8, rows - chrome);
    const sidebarW = Math.max(28, Math.min(38, Math.floor(cols * 0.25)));
    const mainW = Math.max(40, cols - sidebarW - 1);
    return { mainH, mainW, sidebarW };
  }, [window.columns, window.rows, inputText]);

  // ── Command Handler ──
  const handleCommand = useCallback(async (raw: string): Promise<string | null> => {
    const result: SlashCommandResult | null = await registry.execute(raw, {
      cwd: process.cwd(),
      meta: { modelName: meta.modelName, mode: legacyMode, sessionId: meta.sessionId },
    });
    if (!result) {
      state.addEvent("error", "Unknown command: " + raw, { severity: "error" });
      return null;
    }
    if (result.clear) { state.clearScreen(); setStatusText("Ready"); }
    if (result.mode) {
      const modeMap: Record<string, Parameters<typeof nav.navigateTo>[0]> = {
        chat: { primary: "stream", overlay: null },
        plan: { primary: "plan" },
        diff: { overlay: "diff" },
        logs: { overlay: "logs" },
        review: { overlay: "review" },
        approve: { overlay: "approve" },
        model: { overlay: "model" },
        checkpoint: { overlay: "checkpoint" },
        skill: { overlay: "skill" },
        memory: { overlay: "memory" },
      };
      const target = modeMap[result.mode];
      if (target) nav.navigateTo(target);
    }
    if ((result as any).theme) {
      const tn = String((result as any).theme);
      // Theme provider validates internally
      setTheme(tn as any);
      state.addEvent("system", `Theme switched: ${tn}`, { severity: "info", collapsed: false });
    }
    if (result.showHelp) setShowHelp(true);
    if (result.systemMessage) {
      state.addEvent("system", result.systemMessage, { severity: "info", collapsed: false });
    }
    if (result.prompt) return result.prompt;
    return null;
  }, [meta.modelName, meta.sessionId, registry, state, legacyMode, nav, setTheme]);

  // ── Event Processing ──
  const processEvents = useCallback(async (message: string) => {
    state.setIsProcessing(true);
    setStatusText("Thinking...");
    autoFollowRef.current = true;
    state.addEvent("user", message, { severity: "info", collapsed: true });

    // P4.1: Record user message to transcript
    transcriptRef.current?.recordUser(message);

    const toolStartTimes = new Map<string, number>();
    const streamRefs = { streamRespId: null as string | null, streamThinkId: null as string | null };

    const { generator, abort } = onMessage(message);
    currentAbortRef.current = abort;

    try {
      for await (const event of generator) {
        state.resetStreamIdleTimer();
        // P4.1: Record agent events to transcript
        if (event.type === "response") {
          const e = event as any;
          transcriptRef.current?.recordAssistant(e.content, e.toolCalls);
        } else if (event.type === "tool_call") {
          const call = (event as any).call;
          transcriptRef.current?.recordAssistant("", [call]);
        } else if (event.type === "tool_result") {
          const result = (event as any).result;
          transcriptRef.current?.recordToolResult(result);
        } else if (event.type === "error") {
          transcriptRef.current?.recordSystem(`Error: ${(event as any).error}`);
        }

        if (event.type.startsWith("agent_") || event.type === "handoff" || event.type === "synthesis" || event.type === "broadcast" || event.type === "mode_selected" || event.type === "plan_created" || event.type === "plan_revised" || event.type === "evaluation" || event.type === "gan_round" || event.type === "gan_done") {
          dispatchOrchestratorEvent(event as OrchestratorEvent, { state, setStatusText, toolStartTimes, streamRefs });
        } else {
          dispatchAgentEvent(event as AgentEvent, { state, setStatusText, toolStartTimes, streamRefs });
        }
      }
    } catch (e) {
      const msg = String(e);
      if (msg.includes("abort") || msg.includes("Abort") || msg.includes("interrupted") || msg.includes("Interrupted")) {
        state.addEvent("system", "Request interrupted by user.", { severity: "warning", collapsed: false });
        transcriptRef.current?.recordSystem("Request interrupted by user.");
        setStatusText("Interrupted");
      } else {
        state.addEvent("error", msg, { severity: "error", collapsed: false });
        state.addError({ severity: "error", title: "Unexpected error", cause: msg, retryable: true });
        transcriptRef.current?.recordSystem(`Error: ${msg}`);
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

  useEffect(() => {
    handleSubmitRef.current = handleSubmit;
  }, [handleSubmit]);

  // ── Keyboard Router (new) ──
  const keyboard = useKeyboardRouter({
    onNavigate: nav.navigateTo,
    onGoBack: nav.goBack,
    onCloseOverlay: nav.closeOverlay,
    onSubmit: (text) => {
      if (text === "__enter__") {
        // B10.2: pending questions
        const pendingQuestions = state.userQuestions.filter(q => q.status === "pending");
        if (pendingQuestions.length > 0 && onQuestionResponse) {
          const question = pendingQuestions[state.selectedQuestionIdx] ?? pendingQuestions[0];
          if (question) {
            const answer = inputText.trim() || question.defaultValue || "";
            state.resolveUserQuestion(question.id, answer);
            onQuestionResponse(answer);
            setInputText(""); setInputCursor(0);
            return;
          }
        }
        const c = cmdSuggestions.length > 0 ? (cmdSuggestions[cmdSelected]?.value ?? inputText) : inputText;
        void handleSubmit(c);
      } else {
        void handleSubmit(text);
      }
    },
    onInterrupt: () => {
      if (currentAbortRef.current) currentAbortRef.current();
      onInterrupt();
      setStatusText("Interrupting...");
    },
    onApproval: (allowed, remember) => {
      const p = state.approvals.filter(a => a.status === "pending");
      if (p.length === 0 || !p[approvalIdx]) return;
      state.resolveApproval(p[approvalIdx].id, allowed ? "approved" : "rejected");
      onApprovalResponse(allowed, remember);
    },
    onQuestionAnswer: (answer) => {
      const pendingQuestions = state.userQuestions.filter(q => q.status === "pending");
      const question = pendingQuestions[state.selectedQuestionIdx] ?? pendingQuestions[0];
      if (question) {
        state.resolveUserQuestion(question.id, answer);
        onQuestionResponse?.(answer);
      }
    },
    onScroll: (dir, page) => {
      autoFollowRef.current = false;
      lastUserScrollAt.current = Date.now();
      const steps = page ? PAGE_SCROLL_SIZE : 1;
      if (nav.current.overlay === "diff") {
        setDiffScroll(s => Math.max(0, s + dir * steps));
      } else if (nav.current.overlay === "logs") {
        setLogScroll(s => Math.max(0, s + dir * steps));
      } else if (nav.current.overlay === "approve") {
        setApprovalIdx(i => Math.max(0, i + dir));
      } else {
        for (let i = 0; i < steps; i++) state.scrollEvent(dir as 1 | -1);
      }
    },
    onScrollToEnd: () => {
      autoFollowRef.current = true;
      state.setSelectedEventIdx(state.events.length - 1);
    },
    onToggleCollapse: () => {
      const ev = state.events[state.selectedEventIdx];
      if (ev) state.toggleEventCollapse(ev.id);
    },
    onFocusInput: () => setInputFocused(true),
    onBlurInput: () => setInputFocused(false),
    onExit: () => exit(),
    onClearScreen: () => state.clearScreen(),
    onToggleHelp: () => {
      setShowHelp(h => {
        const next = !h;
        // Blur input when help opens, focus when closes
        setInputFocused(!next);
        return next;
      });
    },
    onRetry: () => { if (lastMessage && !busy) void handleSubmit(lastMessage); },
    onCycleDiffFile: (dir) => {
      const n = state.diffs.length;
      if (n <= 1) return;
      setDiffFileIdx((i) => {
        const next = (i + dir + n) % n;
        return next;
      });
    },
    onSetCmdSelected: setCmdSelected,
    onUseSuggestion: (value) => {
      if (value === "__tab__") {
        const c = cmdSuggestions[cmdSelected]?.value;
        if (c) { setInputText(c + " "); setInputCursor(c.length + 1); }
      }
    },
    onInputChange: (_updater) => {
      // No longer used; input editing is handled by onInputEdit
    },
    onInputEdit: (op) => {
      if (op.type === "insert") {
        setInputText(v => {
          const cur = Math.max(0, Math.min(inputCursor, v.length));
          setInputCursor(cur + op.text.length);
          return v.slice(0, cur) + op.text + v.slice(cur);
        });
      } else if (op.type === "delete" && op.direction === "back") {
        setInputText(v => {
          if (inputCursor <= 0) return v;
          setInputCursor(c => Math.max(0, c - 1));
          return v.slice(0, inputCursor - 1) + v.slice(inputCursor);
        });
      } else if (op.type === "delete" && op.direction === "forward") {
        setInputText(v => inputCursor >= v.length ? v : v.slice(0, inputCursor) + v.slice(inputCursor + 1));
      } else if (op.type === "newline") {
        setInputText(v => {
          const cur = Math.max(0, Math.min(inputCursor, v.length));
          setInputCursor(cur + 1);
          return v.slice(0, cur) + "\n" + v.slice(cur);
        });
      }
    },
    onCursorChange: setInputCursor,
    onHistoryNav: (dir) => {
      const h = state.inputHistory;
      if (h.length === 0) return;
      if (dir < 0) {
        const ni = historyIdx < 0 ? h.length - 1 : Math.max(0, historyIdx - 1);
        setHistoryIdx(ni); const v = h[ni] ?? ""; setInputText(v); setInputCursor(v.length);
      } else {
        if (historyIdx >= 0) {
          const ni = historyIdx + 1;
          if (ni >= h.length) { setHistoryIdx(-1); setInputText(""); setInputCursor(0); }
          else { setHistoryIdx(ni); const v = h[ni] ?? ""; setInputText(v); setInputCursor(v.length); }
        }
      }
    },
  });

  // ── Input Handler (bridges useInput → keyboard router + navigation prefix) ──
  useInput(useCallback((ch: string, key: any) => {
    // First: let navigation handle g/b prefixes
    const navResult = nav.handlePrefix(ch);
    if (navResult.consumed) return;

    // Then: keyboard router
    keyboard.route(ch, key, {
      view: nav.current,
      isProcessing: busy,
      inputFocused,
      inputText,
      hasPendingApproval: state.approvals.filter(a => a.status === "pending").length > 0,
      hasPendingQuestion: state.userQuestions.filter(q => q.status === "pending").length > 0,
      cmdSuggestionsCount: cmdSuggestions.length,
      cmdSelected,
      showHelp,
    });

    // All input editing is now handled by keyboard router
    // No fallback needed
  }, [keyboard, nav, busy, inputFocused, inputText, state.approvals, state.userQuestions, cmdSuggestions, cmdSelected, showHelp]));

  // T2: ErrorDisplay timer — tick-driven so errors auto-expire after 30s
  const [errorTick, setErrorTick] = useState(0);
  useEffect(() => {
    if (state.errors.length === 0) return;
    const t = setInterval(() => setErrorTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, [state.errors.length]);
  const recentErrors = useMemo(() => state.errors.filter(e => Date.now() - e.timestamp < 30000), [state.errors, errorTick]);
  const inputDisplayWidth = useMemo(() => Math.max(10, layout.mainW - 6), [layout.mainW]);

  // ── Main Content (Primary View - always rendered) ──
  const primaryContent = useMemo(() => {
    if (showHelp) {
      return (
        <HelpPanel
          currentMode={legacyMode}
          maxHeight={layout.mainH}
          primaryView={nav.current.primary}
          overlay={nav.current.overlay}
          sidebar={nav.current.sidebar}
          isProcessing={busy}
          pendingApprovals={state.approvals.length}
          pendingQuestions={state.userQuestions.length}
          hasAgents={state.agents.length > 0}
        />
      );
    }

    switch (nav.current.primary) {
      case "stream": {
        const pendingApprovals = state.approvals.filter(a => a.status === "pending");
        const pendingQuestions = state.userQuestions.filter(q => q.status === "pending");
        const activeApproval = pendingApprovals[approvalIdx] ?? pendingApprovals[0];
        const activeQuestion = pendingQuestions[state.selectedQuestionIdx] ?? pendingQuestions[0];
        const onboardingH = showOnboarding ? Math.min(24, layout.mainH) : 0;
        return (
          <Box flexDirection="column" flexGrow={1}>
            {showOnboarding && (
              <OnboardingPanel
                maxHeight={Math.min(24, layout.mainH)}
                onComplete={() => setShowOnboarding(false)}
              />
            )}
            {recentErrors.length > 0 && <Box marginBottom={1}><ErrorDisplay errors={recentErrors} maxErrors={2} /></Box>}
            {activeApproval && (
              <InteractionCard
                type="approval"
                approval={activeApproval}
              />
            )}
            {activeQuestion && (
              <InteractionCard
                type="question"
                question={activeQuestion}
              />
            )}
            {skillCandidates && skillCandidates.length > 0 && (
              <SkillLearnerToast
                candidates={skillCandidates}
                onDismiss={() => setSkillCandidates(null)}
                onSave={(candidate) => {
                  state.addEvent("system", `Saved skill: ${candidate.name}`, { severity: "success", collapsed: false });
                  setSkillCandidates(null);
                }}
              />
            )}
            <EventStream events={state.events} selectedIdx={state.selectedEventIdx} maxHeight={layout.mainH - onboardingH - (recentErrors.length > 0 ? 5 : 0) - (activeApproval || activeQuestion ? 6 : 0) - (skillCandidates && skillCandidates.length > 0 ? 8 : 0)} />
          </Box>
        );
      }
      case "plan":
        return <PlanPanel plan={state.plan} maxHeight={layout.mainH} />;
      case "agents":
        return (
          <AgentPanel
            agents={state.agents}
            mailbox={state.mailbox}
            selectedAgentId={state.selectedAgentId}
            mode={legacyMode}
            onSelectAgent={state.setSelectedAgentId}
            onChangeMode={(mode) => {
              const map: Record<string, Parameters<typeof nav.navigateTo>[0]> = {
                chat: { primary: "stream", overlay: null },
                plan: { primary: "plan" },
                agents: { primary: "agents" },
              };
              const target = map[mode];
              if (target) nav.navigateTo(target);
            }}
          />
        );
      default:
        return null;
    }
  }, [showHelp, showOnboarding, nav.current.primary, legacyMode, state.events, state.selectedEventIdx, state.approvals, state.plan, state.agents, state.mailbox, state.selectedAgentId, state.userQuestions, recentErrors, layout.mainH]);

  // ── Overlay Content (rendered on top) ──
  const overlayContent = useMemo(() => {
    if (!nav.current.overlay || showHelp) return null;

    switch (nav.current.overlay) {
      case "diff":
        return <DiffPanel diffs={state.diffs} selectedFileIdx={diffFileIdx} scrollOffset={diffScroll} maxHeight={layout.mainH} />;
      case "logs":
        return <LogPanel events={state.events} errors={state.errors} longTasks={state.longTasks} maxHeight={layout.mainH} scrollOffset={logScroll} />;
      case "approve":
        return <ApprovalPanel approvals={state.approvals} selectedIdx={approvalIdx} maxHeight={layout.mainH} />;
      case "review":
        return (
          <Box flexDirection="column" paddingX={1}>
            <Text bold color={theme.colors.system}>Review Mode</Text>
            {state.errors.length > 0 && <Box marginTop={1}><ErrorDisplay errors={state.errors} maxErrors={5} /></Box>}
          </Box>
        );
      case "model": {
        if (!modelRouter) return null;
        const providers = modelRouter.listProviders();
        const healthMap = modelRouter.getHealthMetrics();
        const modelInfos = providers.map((name) => {
          const p = modelRouter.getProvider(name);
          return {
            name,
            provider: p?.provider ?? "unknown",
            capabilities: p?.capabilities,
            health: healthMap.get(name),
            isDefault: modelRouter.getDefault().name === name,
          };
        });
        return (
          <ModelPickerOverlay
            models={modelInfos}
            currentDefault={modelRouter.getDefault().name}
            onSelect={(name) => { modelRouter.setDefault(name); state.addEvent("system", `Switched to model: ${name}`, { severity: "info", collapsed: false }); }}
            onClose={() => nav.navigateTo({ overlay: null })}
            maxHeight={layout.mainH}
          />
        );
      }
      case "checkpoint": {
        return (
          <CheckpointStackPanel
            entries={state.checkpoints}
            pointer={state.checkpointPointer}
            onRestore={async (id) => {
              const { restoreSnapshot } = await import("@rookie/agent-sdk");
              const projectRoot = process.cwd();
              const success = await restoreSnapshot(projectRoot, id);
              if (success) {
                state.addEvent("system", `Restored checkpoint: ${id.slice(0, 8)}`, { severity: "success", collapsed: false });
              } else {
                state.addEvent("error", `Failed to restore checkpoint: ${id.slice(0, 8)}`, { severity: "error", collapsed: false });
              }
            }}
            onClose={() => nav.navigateTo({ overlay: null })}
            maxHeight={layout.mainH}
          />
        );
      }
      case "skill": {
        // Gather skills from command registry (skills register as slash commands)
        const skillCmds = registry.list().filter(cmd => cmd.category === "skill" || cmd.source === "skill");
        const skillItems = skillCmds.map(cmd => ({
          name: cmd.name,
          version: "1.0.0",
          description: cmd.description,
          triggers: [{ type: "command" as const, value: `/${cmd.name}` }],
          tools: [],
          prompt: "",
          examples: [],
        }));
        return (
          <SkillListOverlay
            skills={skillItems}
            onSelect={(skill) => {
              state.addEvent("system", `Skill: ${skill.name} — ${skill.description}`, { severity: "info", collapsed: false });
            }}
            onClose={() => nav.navigateTo({ overlay: null })}
            maxHeight={layout.mainH}
          />
        );
      }
      case "memory": {
        return (
          <MemoryBrowserOverlay
            memories={memories}
            onClose={() => nav.navigateTo({ overlay: null })}
            maxHeight={layout.mainH}
          />
        );
      }
      default:
        return null;
    }
  }, [nav.current.overlay, showHelp, state.diffs, state.approvals, state.events, state.errors, state.longTasks, state.checkpoints, state.checkpointPointer, diffScroll, logScroll, approvalIdx, diffFileIdx, layout.mainH]);

  return (
    <Box flexDirection="column" height={window.rows}>
      <TopStatusBar status={state.status} mode={legacyMode} version={meta.version} isProcessing={busy} isPlanMode={nav.current.primary === "plan"} />

      <Box flexGrow={1} flexDirection="row">
        {/* Main content area */}
        <Box width={layout.mainW} flexDirection="column" overflow="hidden">
          {primaryContent}
        </Box>

        {/* Sidebar */}
        <Box width={layout.sidebarW} flexDirection="column" borderStyle="single" borderLeft borderTop={false} borderRight={false} borderBottom={false} borderColor={theme.colors.border}>
          <Box paddingX={1} flexDirection="column" overflow="hidden">
            <ContextPanel
              context={state.context}
              longTasks={state.longTasks}
              model={meta.modelName}
              sessionAge={sessionAge}
              maxHeight={layout.mainH}
              tab={nav.current.sidebar}
              commands={registry.list().map((c) => ({ name: c.name, description: c.description, usage: c.usage, category: c.category }))}
              agents={state.agents}
            />
          </Box>
        </Box>
      </Box>

      {/* Overlay layer */}
      {overlayContent && (
        <Box
          position="absolute"
          top={2}
          left={0}
          width={layout.mainW}
          height={layout.mainH}
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.colors.system}
          paddingX={1}
        >
          <Box justifyContent="space-between" marginBottom={1}>
            <Text bold color={theme.colors.system}>{nav.current.overlay?.toUpperCase()}</Text>
            <Text color={theme.colors.textDim}>Esc or Ctrl+O to close</Text>
          </Box>
          {overlayContent}
        </Box>
      )}

      {cmdSuggestions.length > 0 && <CommandSuggestions items={cmdSuggestions} selectedIndex={cmdSelected} />}

      {/* Input panel - always visible except in plan mode */}
      {nav.current.primary !== "plan" && (
        <InputPanel
          value={inputText}
          cursor={inputCursor}
          mode={legacyMode}
          disabled={busy}
          placeholder={
            state.userQuestions.filter(q => q.status === "pending").length > 0
              ? "Answer the question above and press Enter..."
              : busy
                ? "Processing... (Ctrl+C to interrupt)"
                : "Type a message or /command... (g=navigate)"
          }
          displayWidth={inputDisplayWidth}
        />
      )}

      {nav.current.primary === "plan" && (
        <Box paddingX={1} height={3} borderStyle="single" borderColor={theme.colors.border}>
          <Text color={theme.colors.textDim}>
            Plan Mode (read-only) │ Press <Text bold color={theme.colors.system}>g c</Text> to return to chat │ <Text bold color={theme.colors.system}>j/k</Text> to scroll
          </Text>
        </Box>
      )}

      <BottomBar
        mode={legacyMode}
        isProcessing={busy}
        statusText={statusText}
        tokensUsed={tokenInfo.tokensUsed}
        costUsd={tokenInfo.costUsd}
        inputFocused={inputFocused}
        streamStatus={state.status.streamStatus}
        prefixHint={keyboard.prefixHint}
        overlay={nav.current.overlay}
      />
    </Box>
  );
}
