// ─── Event Dispatcher Map ────────────────────────────────────────
// P1-EX.1: Declarative mapping from AgentEvent type → handler.
// Adding a new event type only requires adding an entry here.

import type { AgentEvent, OrchestratorEvent } from "@rookie/agent-sdk";
import type { TuiStateAPI } from "../hooks/useTuiState.js";
import type { RiskLevel, ApprovalAction } from "../types.js";

export type EventHandlerContext = {
  state: TuiStateAPI;
  setStatusText: (text: string) => void;
  toolStartTimes: Map<string, number>;
  streamRefs: {
    streamThinkId: string | null;
    streamRespId: string | null;
  };
};

export type EventHandler = (event: AgentEvent, ctx: EventHandlerContext) => void;

const DANGEROUS_TOOLS = new Set(["shell_execute", "file_write", "file_edit"]);

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}

export const AGENT_EVENT_MAP: Record<string, EventHandler> = {
  thinking: (event, { state, setStatusText, streamRefs }) => {
    if (!streamRefs.streamThinkId) {
      streamRefs.streamThinkId = state.addEvent("intent", (event as any).content, { severity: "info", collapsed: true });
    } else {
      state.appendToEvent(streamRefs.streamThinkId, (event as any).content);
    }
    setStatusText("Thinking...");
  },

  tool_call: (event, { state, setStatusText, toolStartTimes, streamRefs }) => {
    streamRefs.streamThinkId = null;
    const call = (event as any).call;
    const tn = call.name;
    toolStartTimes.set(call.id, Date.now());
    if (DANGEROUS_TOOLS.has(tn)) {
      const risk: RiskLevel = tn === "shell_execute" ? "high" : "medium";
      const scope = tn === "shell_execute" ? String(call.params.command ?? "") : String(call.params.path ?? "");
      state.addApproval({ action: tn as ApprovalAction, scope, riskLevel: risk, description: tn + ": " + truncate(scope, 60), detail: JSON.stringify(call.params, null, 2), toolCall: call });
    }
    state.addEvent("action", "Calling " + tn, { severity: "info", toolName: tn, detail: JSON.stringify(call.params, null, 2), collapsed: true });
    if (tn === "file_write" || tn === "file_edit") {
      const fp = String(call.params.path ?? "");
      if (fp) state.addActiveFile(fp);
    }
    if (tn === "file_read") {
      const fp = String(call.params.path ?? "");
      if (fp) state.addRecentFile(fp);
    }
    setStatusText("Running " + tn + "...");
  },

  tool_result: (event, { state, setStatusText, toolStartTimes, streamRefs }) => {
    streamRefs.streamThinkId = null;
    const result = (event as any).result;
    const st = toolStartTimes.get(result.id);
    const dur = st ? Date.now() - st : undefined;
    const isErr = !!result.error;
    state.addEvent("result",
      isErr ? "Error: " + truncate(result.error ?? "", 80) : result.name + " completed",
      { severity: isErr ? "error" : "success", toolName: result.name, detail: result.output || result.error, collapsed: true, durationMs: dur }
    );
    if (isErr) {
      state.addError({ severity: "error", title: "Tool " + result.name + " failed", cause: result.error, suggestion: "The agent will attempt to recover automatically.", retryable: true });
    }
    // P1-EX.5/6: Wire plan/diff panels to tool results
    if (!isErr && result.name === "todo_write" && result.output) {
      // Parse todo counts from output: "Now N todo(s) [pending=X in_progress=Y ...]"
      const m = result.output.match(/Now (\d+) todo\(s\).*\[pending=(\d+) in_progress=(\d+) completed=(\d+)/);
      if (m) {
        const total = Number(m[1]);
        const pending = Number(m[2]);
        const inProgress = Number(m[3]);
        const completed = Number(m[4]);
        state.updatePlan(prev => ({
          title: prev?.title ?? "Plan",
          steps: prev?.steps ?? [],
          completionPct: Math.round((completed / Math.max(1, total)) * 100),
        }));

        // Keep sidebar task counts aligned (pending includes in_progress)
        state.setTaskCount?.({
          total,
          done: completed,
          pending: pending + inProgress,
        });
      }
    }
    if (!isErr && (result.name === "file_edit" || result.name === "edit_apply_diff") && result.output) {
      const pathMatch = result.output.match(/(?:Applied diff to|Wrote) (.+?)(?:\s+\(|\s*—|$)/);
      if (pathMatch) {
        const filePath = pathMatch[1].trim();
        state.addDiff({ path: filePath, status: "modified", hunks: [] });
        // P3.3: Push checkpoint entry for undo stack
        if (state.pushCheckpoint) {
          state.pushCheckpoint({
            id: `ck_${Date.now()}_${filePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
            filePath,
            timestamp: Date.now(),
            label: `Edit ${filePath}`,
            size: 0,
          });
        }
      }
    }
    setStatusText("Processing...");
  },

  response: (event, { state, setStatusText, streamRefs }) => {
    streamRefs.streamThinkId = null;
    const e = event as any;
    if (!streamRefs.streamRespId) {
      streamRefs.streamRespId = state.addEvent("result", e.content, { severity: "success", collapsed: false });
    } else {
      state.appendToEvent(streamRefs.streamRespId, e.content);
    }
    if (e.done) { streamRefs.streamRespId = null; setStatusText("Ready"); }
    else { setStatusText("Streaming..."); }
  },

  error: (event, { state, setStatusText }) => {
    const e = event as any;
    state.addEvent("error", e.error, { severity: "error", collapsed: false });
    state.addError({ severity: "error", title: "Agent error", cause: e.error, retryable: true });
    setStatusText("Error");
  },

  skill_invoked: (event, { state }) => {
    state.addEvent("action", "Skill: " + (event as any).skill, { severity: "info", collapsed: true });
  },

  hook_fired: (event, { state }) => {
    state.addEvent("system", "Hook: " + (event as any).hook, { severity: "info", collapsed: true });
  },

  system_message: (event, { state }) => {
    state.addEvent("system", (event as any).content, { severity: "info", collapsed: false });
  },

  compacted: (event, { state, setStatusText }) => {
    const e = event as any;
    const beforeMsgs = e.before?.messages ?? "?";
    const beforeTokens = e.before?.tokens ?? "?";
    const afterMsgs = e.after?.messages ?? "?";
    const afterTokens = e.after?.tokens ?? "?";
    state.addEvent("system", `↧ Compacted ${beforeMsgs}→${afterMsgs} msgs, ${beforeTokens}→${afterTokens} tokens`, { severity: "info", collapsed: true });
    setStatusText("Context compacted");
  },

  checkpoint: (_event, { state }) => {
    state.addEvent("system", "Checkpoint saved", { severity: "success", collapsed: true });
  },

  user_question: (event, { state, setStatusText, streamRefs }) => {
    streamRefs.streamThinkId = null;
    const e = event as any;
    state.addUserQuestion({
      question: e.question,
      options: e.options,
      defaultValue: e.defaultValue,
      toolCall: { id: e.id, name: "AskUserQuestion", params: {} },
    });
    setStatusText("Waiting for user...");
  },

  user_question_answer: (event, { state, setStatusText }) => {
    state.addEvent("system", "User answered: " + (event as any).answer, { severity: "info", collapsed: true });
    setStatusText("Processing...");
  },
};

// Orchestrator events (P1-EX.7)
export const ORCHESTRATOR_EVENT_MAP: Record<string, (event: OrchestratorEvent, ctx: EventHandlerContext) => void> = {
  agent_start: (event, { state }) => {
    state.updateAgent(event.agent, { state: "running", taskSummary: String(event.data ?? "") });
  },
  agent_complete: (event, { state }) => {
    state.updateAgent(event.agent, { state: "done", taskSummary: String(event.data ?? "") });
  },
  agent_error: (event, { state }) => {
    state.updateAgent(event.agent, { state: "error", taskSummary: String(event.data ?? "") });
  },
  handoff: (event, { state }) => {
    state.addMailboxMessage({ type: "result", from: event.agent, to: "orchestrator", content: String(event.data ?? "") });
  },
  synthesis: (event, { state }) => {
    state.updateAgent(event.agent, { state: "idle" });
    state.addEvent("system", "Synthesis: " + String(event.data ?? ""), { severity: "info", collapsed: true });
  },
};

export function dispatchAgentEvent(event: AgentEvent, ctx: EventHandlerContext): void {
  const handler = AGENT_EVENT_MAP[event.type];
  if (handler) {
    handler(event, ctx);
  } else {
    // Unknown event type — log as system event for visibility
    ctx.state.addEvent("system", `Unknown event: ${event.type}`, { severity: "warning", collapsed: true });
  }
}

export function dispatchOrchestratorEvent(event: OrchestratorEvent, ctx: EventHandlerContext): void {
  const handler = ORCHESTRATOR_EVENT_MAP[event.type];
  if (handler) {
    handler(event, ctx);
  }
}
