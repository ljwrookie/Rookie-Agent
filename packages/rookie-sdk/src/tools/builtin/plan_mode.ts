// ─── PlanMode Tool ───────────────────────────────────────────────
// B10.4: Toggle plan mode on/off

import { Tool } from "../types.js";

export interface PlanModeCallbacks {
  onEnterPlanMode?: () => void;
  onExitPlanMode?: () => void;
  isInPlanMode?: () => boolean;
}

// Global state for plan mode (in production, this would be in session state)
let globalPlanModeState = {
  isPlanMode: false,
  callbacks: {} as PlanModeCallbacks,
};

export function setPlanModeCallbacks(callbacks: PlanModeCallbacks): void {
  globalPlanModeState.callbacks = callbacks;
}

export function isPlanModeActive(): boolean {
  return globalPlanModeState.callbacks.isInPlanMode
    ? globalPlanModeState.callbacks.isInPlanMode()
    : globalPlanModeState.isPlanMode;
}

export function createPlanModeTool(callbacks?: PlanModeCallbacks): Tool {
  if (callbacks) {
    setPlanModeCallbacks(callbacks);
  }

  return {
    name: "PlanMode",
    description:
      "Toggle plan mode on or off. " +
      "In plan mode, only read-only tools are available (file_read, grep, glob, etc.). " +
      "Use this to explore and plan before making changes.",
    parameters: [
      {
        name: "action",
        type: "string",
        description: "Action to take: 'enter', 'exit', or 'toggle'",
        required: true,
      },
      {
        name: "reason",
        type: "string",
        description: "Reason for entering/exiting plan mode",
        required: false,
      },
    ],
    isReadOnly: true,
    isConcurrencySafe: true,
    async execute(params: Record<string, unknown>): Promise<string> {
      const action = String(params.action).toLowerCase();
      const reason = params.reason ? String(params.reason) : undefined;

      const currentState = isPlanModeActive();
      let newState = currentState;

      switch (action) {
        case "enter":
        case "on":
        case "true":
          newState = true;
          break;
        case "exit":
        case "off":
        case "false":
          newState = false;
          break;
        case "toggle":
          newState = !currentState;
          break;
        default:
          return `[ERROR] Invalid action: ${action}. Use 'enter', 'exit', or 'toggle'.`;
      }

      // Update state
      globalPlanModeState.isPlanMode = newState;

      // Trigger callbacks
      if (newState !== currentState) {
        if (newState && globalPlanModeState.callbacks.onEnterPlanMode) {
          globalPlanModeState.callbacks.onEnterPlanMode();
        } else if (!newState && globalPlanModeState.callbacks.onExitPlanMode) {
          globalPlanModeState.callbacks.onExitPlanMode();
        }
      }

      // Format response
      const statusEmoji = newState ? "📋" : "💻";
      const statusText = newState ? "PLAN MODE" : "NORMAL MODE";
      const actionText = newState === currentState
        ? "already in"
        : newState
          ? "entered"
          : "exited";

      let response = `${statusEmoji} ${statusText}\n`;
      response += `Action: ${actionText} plan mode\n`;

      if (reason) {
        response += `Reason: ${reason}\n`;
      }

      if (newState) {
        response += "\nAvailable tools (read-only):\n";
        response += "  • file_read, glob_files, grep_files\n";
        response += "  • search_code, git_status, git_diff\n";
        response += "  • web_search, web_fetch\n";
        response += "\nUse PlanMode(action: 'exit') when ready to make changes.";
      } else {
        response += "\nAll tools are now available.";
      }

      return response;
    },
  };
}

export const planModeTool: Tool = createPlanModeTool();
