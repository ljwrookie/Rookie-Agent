/**
 * Git Integration Plugin (Built-in)
 * 
 * Enhanced Git workflows and hooks.
 */

import { Plugin, PluginContext } from "../types.js";

export const gitIntegrationPlugin: Plugin = {
  meta: {
    name: "@rookie/git-integration",
    version: "1.0.0",
    description: "Enhanced Git workflows and hooks",
    author: "Rookie Team",
  },

  defaultConfig: {
    settings: {
      autoCommit: false,
      commitMessageTemplate: "[{branch}] {description}",
      preCommitHooks: true,
    },
    permissions: ["file:read", "file:write", "shell", "git"],
  },

  activate(context: PluginContext): void {
    const { logger, config, registerCommand, registerHook, dispatchTool } = context;

    logger.info("Git integration plugin activated");

    // Register git commands
    registerCommand({
      name: "git:smart-commit",
      description: "Create a commit with AI-generated message",
      aliases: ["gc"],
      handler: async (_ctx) => {
        // Get git status
        const statusResult = await dispatchTool("shell", {
          command: "git status --porcelain",
          description: "Get git status",
        });

        if (!statusResult.success) {
          logger.error("Failed to get git status");
          return;
        }

        const changedFiles = (statusResult.output as string || "").trim();
        if (!changedFiles) {
          logger.info("No changes to commit");
          return;
        }

        // Get diff summary
        const diffResult = await dispatchTool("shell", {
          command: "git diff --stat HEAD",
          description: "Get diff summary",
        });

        if (!diffResult.success) {
          logger.warn("Failed to get diff summary");
        } else if (typeof diffResult.output === "string" && diffResult.output.trim()) {
          logger.info("Diff summary:");
          logger.info(diffResult.output.trim());
        }

        logger.info("Changed files:");
        logger.info(changedFiles);

        // Would use LLM to generate commit message in production
        const template = config.settings.commitMessageTemplate as string;
        const branch = "main"; // Would get actual branch
        const message = template
          .replace("{branch}", branch)
          .replace("{description}", "Update files");

        logger.info(`Suggested commit message: ${message}`);
      },
    });

    registerCommand({
      name: "git:pr-summary",
      description: "Generate PR summary from commits",
      handler: async (_ctx) => {
        const result = await dispatchTool("shell", {
          command: "git log --oneline origin/main..HEAD",
          description: "Get commits since main",
        });

        if (!result.success) {
          logger.error("Failed to get commits");
          return;
        }

        const commits = (result.output as string || "").trim();
        if (!commits) {
          logger.info("No commits to summarize");
          return;
        }

        logger.info("Commits:");
        logger.info(commits);

        // Would generate PR summary using LLM
        logger.info("\nPR Summary would be generated here...");
      },
    });

    // Register pre-commit hook
    if (config.settings.preCommitHooks) {
      registerHook({
        name: "file:write",
        type: "observe",
        priority: 100,
        handler: async (ctx) => {
          // Track file writes for potential git operations
          logger.debug(`File modified: ${ctx.meta.source}`);
        },
      });
    }

    // Register transform hook for commit messages
    registerHook({
      name: "git:commit-message",
      type: "transform",
      priority: 50,
      handler: async (ctx) => {
        const message = ctx.data as string;
        
        // Validate commit message format
        if (message.length < 10) {
          logger.warn("Commit message is very short");
        }

        // Could transform message here
        ctx.transform(message);
      },
    });
  },

  deactivate(context: PluginContext): void {
    context.logger.info("Git integration plugin deactivated");
  },
};
