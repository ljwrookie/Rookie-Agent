/**
 * Telemetry Plugin (Built-in)
 * 
 * Collects anonymous usage metrics to improve Rookie Agent.
 */

import { Plugin, PluginContext } from "../types.js";

export const telemetryPlugin: Plugin = {
  meta: {
    name: "@rookie/telemetry",
    version: "1.0.0",
    description: "Collects anonymous usage metrics to improve Rookie Agent",
    author: "Rookie Team",
  },

  defaultConfig: {
    settings: {
      enabled: true,
      anonymize: true,
      sampleRate: 1.0,
    },
    permissions: ["memory:read"],
  },

  activate(context: PluginContext): void {
    const { logger, config, onEvent, emitEvent } = context;
    
    if (!config.settings.enabled) {
      logger.info("Telemetry disabled");
      return;
    }

    logger.info("Telemetry plugin activated");

    // Track tool usage
    onEvent("tool:before", async (data: { tool: string; args: unknown }) => {
      if (Math.random() > (config.settings.sampleRate as number)) {
        return;
      }

      logger.debug(`Tool used: ${data.tool}`);
      
      // Would send to telemetry service in production
      emitEvent("telemetry:tool", {
        tool: data.tool,
        timestamp: Date.now(),
        anonymized: config.settings.anonymize,
      });
    });

    // Track skill usage
    onEvent("skill:invoke", async (data: { skill: string; success: boolean }) => {
      logger.debug(`Skill invoked: ${data.skill}`);
      
      emitEvent("telemetry:skill", {
        skill: data.skill,
        success: data.success,
        timestamp: Date.now(),
      });
    });

    // Track errors (anonymized)
    onEvent("error", async (data: { type: string; message: string }) => {
      emitEvent("telemetry:error", {
        type: data.type,
        timestamp: Date.now(),
      });
    });

    // Register telemetry command
    context.registerCommand({
      name: "telemetry",
      description: "Manage telemetry settings",
      args: [
        { name: "action", description: "enable, disable, or status", required: true, type: "string" },
      ],
      handler: async (ctx) => {
        const action = ctx.args[0];
        
        switch (action) {
          case "enable":
            logger.info("Enabling telemetry...");
            // Would update config
            break;
          case "disable":
            logger.info("Disabling telemetry...");
            // Would update config
            break;
          case "status":
            logger.info(`Telemetry: ${config.settings.enabled ? "enabled" : "disabled"}`);
            logger.info(`Sample rate: ${config.settings.sampleRate}`);
            logger.info(`Anonymization: ${config.settings.anonymize ? "on" : "off"}`);
            break;
          default:
            logger.error(`Unknown action: ${action}`);
        }
      },
    });
  },

  deactivate(context: PluginContext): void {
    context.logger.info("Telemetry plugin deactivated");
  },
};
