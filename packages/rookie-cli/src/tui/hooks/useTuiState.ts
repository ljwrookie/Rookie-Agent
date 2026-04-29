// ─── Central TUI State Hook v2 ───────────────────────────────────
// Thin composition of domain hooks. All business logic lives in domain hooks;
// this file only spreads their APIs for backward compatibility.

import { useMemo } from "react";
import type { StatusInfo } from "../types.js";
import { useApprovalQueue } from "./useApprovalQueue.js";
import { useStreamLifecycle } from "./useStreamLifecycle.js";
import { useWorkspaceContext } from "./useWorkspaceContext.js";
import { useConversation } from "./useConversation.js";
import { useInteraction } from "./useInteraction.js";
import { useAgents } from "./useAgents.js";
import { useUIChrome } from "./useUIChrome.js";
import { useCheckpointStack } from "./useCheckpointStack.js";

export interface TuiStateCallbacks {
  onPlanModeChange?: (isPlanMode: boolean) => void;
}

/** P3.2: Token tracker interface for context gauge */
export interface TokenTrackerLike {
  getTotalUsage: () => { totalTokens: number };
}

/** P3.2: Model router interface for context window lookup */
export interface ModelRouterLike {
  getDefault: () => { name: string; capabilities?: { contextWindow?: number } };
}

export function useTuiState(
  meta: {
    modelName: string;
    directory: string;
    branch?: string;
  },
  opts?: {
    tokenTracker?: TokenTrackerLike;
    modelRouter?: ModelRouterLike;
  }
) {
  // ── Domain Hooks ──
  const conversation = useConversation();
  const interaction = useInteraction();
  const agents = useAgents();
  const workspace = useWorkspaceContext(meta);
  const stream = useStreamLifecycle();
  const chrome = useUIChrome(meta);
  const approvals = useApprovalQueue();
  const checkpoints = useCheckpointStack();

  // ── Status (derived from all domains) ──
  const status: StatusInfo = useMemo(() => {
    // P3.2: Compute context usage ratio
    let contextRatio: number | undefined;
    if (opts?.tokenTracker && opts?.modelRouter) {
      const totalTokens = opts.tokenTracker.getTotalUsage().totalTokens;
      const contextWindow = opts.modelRouter.getDefault().capabilities?.contextWindow;
      if (contextWindow && contextWindow > 0) {
        contextRatio = Math.min(1, totalTokens / contextWindow);
      }
    }

    return {
      model: meta.modelName,
      directory: meta.directory,
      branch: meta.branch,
      permissions: "normal",
      taskStatus: stream.streamStatus === "stalled" ? "stalled" : stream.isProcessing ? "running" : "idle",
      backgroundProcesses: workspace.longTasks.filter(t => t.status === "running").length,
      pendingApprovals: approvals.pendingCount,
      pendingQuestions: interaction.userQuestions.filter(q => q.status === "pending").length,
      streamStatus: stream.streamStatus,
      contextRatio,
    };
  }, [meta, stream, workspace.longTasks, approvals.pendingCount, interaction.userQuestions, opts?.tokenTracker, opts?.modelRouter]);

  return {
    // Legacy mode
    mode: chrome.mode,
    setMode: chrome.setMode,
    isPlanMode: chrome.isPlanMode,

    // Events (delegated)
    events: conversation.events,
    selectedEventIdx: conversation.selectedEventIdx,
    setSelectedEventIdx: conversation.setSelectedEventIdx,
    addEvent: conversation.addEvent,
    appendToEvent: conversation.appendToEvent,
    toggleEventCollapse: conversation.toggleEventCollapse,
    scrollEvent: conversation.scrollEvent,

    // Approvals (delegated)
    approvals: approvals.approvals,
    addApproval: approvals.addApproval,
    resolveApproval: approvals.resolveApproval,

    // Stream lifecycle (delegated)
    isProcessing: stream.isProcessing,
    setIsProcessing: stream.setIsProcessing,
    streamStatus: stream.streamStatus,
    resetStreamIdleTimer: stream.resetStreamIdleTimer,
    setRecoveryCallback: stream.setRecoveryCallback,

    // Workspace (delegated)
    context: workspace.context,
    longTasks: workspace.longTasks,
    addActiveFile: workspace.addActiveFile,
    addRecentFile: workspace.addRecentFile,
    startLongTask: workspace.startLongTask,
    updateLongTask: workspace.updateLongTask,
    updateTaskProgress: workspace.updateTaskProgress,
    setTaskCount: workspace.setTaskCount,

    // Conversation
    plan: conversation.plan,
    updatePlan: conversation.updatePlan,
    diffs: conversation.diffs,
    addDiff: conversation.addDiff,
    clearDiffs: conversation.clearDiffs,
    errors: conversation.errors,
    addError: conversation.addError,
    inputHistory: conversation.inputHistory,
    pushHistory: conversation.pushHistory,
    clearScreen: conversation.clearScreen,

    // Interaction
    userQuestions: interaction.userQuestions,
    selectedQuestionIdx: interaction.selectedQuestionIdx,
    setSelectedQuestionIdx: interaction.setSelectedQuestionIdx,
    addUserQuestion: interaction.addUserQuestion,
    resolveUserQuestion: interaction.resolveUserQuestion,

    // Agents
    agents: agents.agents,
    mailbox: agents.mailbox,
    selectedAgentId: agents.selectedAgentId,
    updateAgent: agents.updateAgent,
    removeAgent: agents.removeAgent,
    addMailboxMessage: agents.addMailboxMessage,
    clearAgents: agents.clearAgents,
    setSelectedAgentId: agents.setSelectedAgentId,

    // Checkpoints (P3.3)
    checkpoints: checkpoints.entries,
    checkpointPointer: checkpoints.pointer,
    canUndo: checkpoints.canUndo,
    canRedo: checkpoints.canRedo,
    pushCheckpoint: checkpoints.pushCheckpoint,
    moveCheckpointPointer: checkpoints.movePointer,

    // Derived
    status,
  };
}

export type TuiStateAPI = ReturnType<typeof useTuiState>;
