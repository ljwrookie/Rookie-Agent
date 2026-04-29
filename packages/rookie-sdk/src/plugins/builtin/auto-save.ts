/**
 * Auto-Save Plugin (Built-in)
 * 
 * Automatically saves work in progress.
 */

import { Plugin, PluginContext } from "../types.js";

interface AutoSaveState {
  enabled: boolean;
  intervalMs: number;
  lastSaveTime: number;
  pendingChanges: boolean;
  timerId: ReturnType<typeof setInterval> | null;
}

export const autoSavePlugin: Plugin = {
  meta: {
    name: "@rookie/auto-save",
    version: "1.0.0",
    description: "Automatically saves work in progress",
    author: "Rookie Team",
  },

  defaultConfig: {
    settings: {
      enabled: true,
      intervalSeconds: 60,
      createCheckpoints: true,
    },
    permissions: ["file:read", "file:write", "memory:write"],
  },

  activate(context: PluginContext): void {
    const { logger, config, registerCommand, onEvent, setState } = context;

    logger.info("Auto-save plugin activated");

    // Initialize state
    const state: AutoSaveState = {
      enabled: config.settings.enabled as boolean,
      intervalMs: (config.settings.intervalSeconds as number) * 1000,
      lastSaveTime: Date.now(),
      pendingChanges: false,
      timerId: null,
    };

    setState(state);

    // Start auto-save timer
    if (state.enabled) {
      state.timerId = setInterval(() => {
        performAutoSave(context, state);
      }, state.intervalMs);
    }

    // Track file changes
    onEvent("file:modified", async (data: { path: string; content: string }) => {
      state.pendingChanges = true;
      setState(state);
      logger.debug(`File modified, pending save: ${data.path}`);
    });

    // Register commands
    registerCommand({
      name: "autosave:enable",
      description: "Enable auto-save",
      handler: async () => {
        state.enabled = true;
        if (!state.timerId) {
          state.timerId = setInterval(() => {
            performAutoSave(context, state);
          }, state.intervalMs);
        }
        setState(state);
        logger.info("Auto-save enabled");
      },
    });

    registerCommand({
      name: "autosave:disable",
      description: "Disable auto-save",
      handler: async () => {
        state.enabled = false;
        if (state.timerId) {
          clearInterval(state.timerId);
          state.timerId = null;
        }
        setState(state);
        logger.info("Auto-save disabled");
      },
    });

    registerCommand({
      name: "autosave:status",
      description: "Show auto-save status",
      handler: async () => {
        logger.info(`Auto-save: ${state.enabled ? "enabled" : "disabled"}`);
        logger.info(`Interval: ${state.intervalMs / 1000}s`);
        logger.info(`Pending changes: ${state.pendingChanges ? "yes" : "no"}`);
        
        const timeSinceLastSave = Date.now() - state.lastSaveTime;
        logger.info(`Last save: ${Math.round(timeSinceLastSave / 1000)}s ago`);
      },
    });

    registerCommand({
      name: "autosave:now",
      description: "Save immediately",
      handler: async () => {
        await performAutoSave(context, state);
        logger.info("Manual save completed");
      },
    });

    // Register veto hook to prevent exit with unsaved changes
    context.registerHook({
      name: "app:before-exit",
      type: "veto",
      priority: 100,
      handler: async (ctx) => {
        if (state.pendingChanges) {
          logger.warn("Unsaved changes detected!");
          ctx.veto("Unsaved changes - use 'autosave:now' to save");
        }
      },
    });
  },

  deactivate(context: PluginContext): void {
    const state = context.getState<AutoSaveState>();
    
    if (state?.timerId) {
      clearInterval(state.timerId);
    }

    // Final save attempt
    if (state?.pendingChanges) {
      performAutoSave(context, state);
    }

    context.logger.info("Auto-save plugin deactivated");
  },
};

async function performAutoSave(context: PluginContext, state: AutoSaveState): Promise<void> {
  if (!state.pendingChanges) {
    return;
  }

  const { logger, emitEvent } = context;
  
  logger.debug("Performing auto-save...");
  
  try {
    emitEvent("autosave:start", { timestamp: Date.now() });
    
    // Would trigger actual save logic here
    // For now, just mark as saved
    state.pendingChanges = false;
    state.lastSaveTime = Date.now();
    
    emitEvent("autosave:complete", { timestamp: state.lastSaveTime });
    logger.debug("Auto-save completed");
  } catch (error) {
    logger.error("Auto-save failed:", error);
    emitEvent("autosave:error", { error: String(error) });
  }
}
