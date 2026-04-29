/**
 * Plugin API Implementation (P8-T3)
 * 
 * Core PluginContext implementation and API surface.
 */

import { EventEmitter } from "events";
import {
  type PluginContext,
  PluginMeta,
  PluginConfig,
  PluginLogger,
  CommandDefinition,
  HookDefinition,
  PluginApi,
  EventHandler,
  PluginPermission,
} from "./types.js";
import { Skill } from "../skills/types.js";
import { Tool, ToolDefinition, ToolResult } from "../tools/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { SkillRegistry } from "../skills/registry.js";

// ─── PluginContext Implementation ──────────────────────────────────

export class PluginContextImpl implements PluginContext {
  readonly meta: PluginMeta;
  config: PluginConfig;
  readonly logger: PluginLogger;
  
  private state: Map<string, unknown> = new Map();
  private eventEmitter = new EventEmitter();
  private commands = new Map<string, CommandDefinition>();
  private hooks = new Map<string, HookDefinition[]>();
  private toolRegistry: ToolRegistry;
  private skillRegistry: SkillRegistry;
  private pluginApis: Map<string, PluginApi>;
  private permissionChecker: PermissionChecker;

  constructor(
    meta: PluginMeta,
    config: PluginConfig,
    toolRegistry: ToolRegistry,
    skillRegistry: SkillRegistry,
    pluginApis: Map<string, PluginApi>,
    parentLogger: PluginLogger
  ) {
    this.meta = meta;
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.skillRegistry = skillRegistry;
    this.pluginApis = pluginApis;
    this.permissionChecker = new PermissionChecker(config.permissions);
    this.logger = new PluginLoggerImpl(meta.name, parentLogger);
  }

  registerCommand(command: CommandDefinition): void {
    this.permissionChecker.check("command:register");
    
    const fullName = `${this.meta.name}:${command.name}`;
    this.commands.set(fullName, command);
    
    this.logger.debug(`Registered command: ${fullName}`);
  }

  registerTool(tool: ToolDefinition): void {
    this.permissionChecker.check("tool:register");
    
    // Wrap tool to add plugin context
    const wrappedTool: Tool = {
      name: `${this.meta.name}:${tool.name}`,
      description: tool.description,
      parameters: [],
      execute: async (params) => tool.execute(params as never),
      isReadOnly: tool.isReadOnly,
      isConcurrencySafe: tool.isConcurrencySafe,
      isDestructive: tool.isDestructive,
    };
    
    this.toolRegistry.register(wrappedTool);
    this.logger.debug(`Registered tool: ${wrappedTool.name}`);
  }

  registerSkill(skill: Skill): void {
    this.permissionChecker.check("skill:register");
    
    // Tag skill with plugin source
    const taggedSkill: Skill = {
      ...skill,
      metadata: {
        ...skill.metadata,
        pluginSource: this.meta.name,
      },
    };
    
    this.skillRegistry.register(taggedSkill);
    this.logger.debug(`Registered skill: ${skill.name}`);
  }

  getAllSkills(): Skill[] {
    return this.skillRegistry.list();
  }

  async dispatchTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    // Check if tool requires file/network/shell permissions
    if (name.startsWith("file/")) {
      this.permissionChecker.check("file:read");
      if (args.content || args.write) {
        this.permissionChecker.check("file:write");
      }
    }
    if (name.startsWith("shell/")) {
      this.permissionChecker.check("shell");
    }
    
    const output = await this.toolRegistry.invoke(name, args);
    return { success: true, output };
  }

  onEvent<T = unknown>(event: string, handler: EventHandler<T>): void {
    this.eventEmitter.on(event, handler);
  }

  emitEvent<T = unknown>(event: string, data: T): void {
    this.eventEmitter.emit(event, data, {
      event,
      timestamp: Date.now(),
      source: this.meta.name,
    });
  }

  getState<T = unknown>(): T {
    return this.state.get("_plugin_state") as T;
  }

  setState<T = unknown>(state: T): void {
    this.state.set("_plugin_state", state);
  }

  getPlugin(name: string): PluginApi | undefined {
    return this.pluginApis.get(name);
  }

  registerHook(hook: HookDefinition): void {
    this.permissionChecker.check("hook:register");
    
    const hooks = this.hooks.get(hook.name) || [];
    hooks.push(hook);
    // Sort by priority (higher first)
    hooks.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this.hooks.set(hook.name, hooks);
    
    this.logger.debug(`Registered ${hook.type} hook: ${hook.name}`);
  }

  // ─── Internal Methods ────────────────────────────────────────────

  getCommands(): Map<string, CommandDefinition> {
    return this.commands;
  }

  getHooks(name: string): HookDefinition[] {
    return this.hooks.get(name) || [];
  }

  cleanup(): void {
    this.eventEmitter.removeAllListeners();
    this.commands.clear();
    this.hooks.clear();
    this.state.clear();
  }
}

// ─── Permission Checker ────────────────────────────────────────────

class PermissionChecker {
  private permissions: Set<PluginPermission>;

  constructor(permissions: PluginPermission[]) {
    this.permissions = new Set(permissions);
  }

  check(permission: PluginPermission): void {
    if (!this.permissions.has(permission)) {
      throw new PermissionDeniedError(permission);
    }
  }

  has(permission: PluginPermission): boolean {
    return this.permissions.has(permission);
  }
}

export class PermissionDeniedError extends Error {
  readonly permission: PluginPermission;

  constructor(permission: PluginPermission) {
    super(`Permission denied: ${permission}`);
    this.name = "PermissionDeniedError";
    this.permission = permission;
  }
}

// ─── Plugin Logger Implementation ──────────────────────────────────

class PluginLoggerImpl implements PluginLogger {
  private prefix: string;
  private parent: PluginLogger;

  constructor(pluginName: string, parent: PluginLogger) {
    this.prefix = `[${pluginName}]`;
    this.parent = parent;
  }

  debug(message: string, ...args: unknown[]): void {
    this.parent.debug(`${this.prefix} ${message}`, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.parent.info(`${this.prefix} ${message}`, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.parent.warn(`${this.prefix} ${message}`, ...args);
  }

  error(message: string, ...args: unknown[]): void {
    this.parent.error(`${this.prefix} ${message}`, ...args);
  }
}

// ─── Global Plugin Logger ──────────────────────────────────────────

export const globalPluginLogger: PluginLogger = {
  debug: (msg, ...args) => console.debug(`[Plugin] ${msg}`, ...args),
  info: (msg, ...args) => console.info(`[Plugin] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[Plugin] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[Plugin] ${msg}`, ...args),
};

// ─── Hook Execution Engine ─────────────────────────────────────────

export interface HookExecutor {
  executeVeto<T>(hookName: string, data: T): Promise<VetoResult>;
  executeTransform<T>(hookName: string, data: T): Promise<T>;
  executeObserve<T>(hookName: string, data: T): Promise<void>;
}

export interface VetoResult {
  vetoed: boolean;
  reason?: string;
}

export class HookExecutorImpl implements HookExecutor {
  private contexts: Map<string, PluginContextImpl>;

  constructor(contexts: Map<string, PluginContextImpl>) {
    this.contexts = contexts;
  }

  async executeVeto<T>(hookName: string, data: T): Promise<VetoResult> {
    const allHooks: Array<{ plugin: string; hook: HookDefinition }> = [];
    
    for (const [pluginName, context] of this.contexts) {
      const hooks = context.getHooks(hookName);
      for (const hook of hooks) {
        if (hook.type === "veto") {
          allHooks.push({ plugin: pluginName, hook });
        }
      }
    }

    // Sort by priority
    allHooks.sort((a, b) => (b.hook.priority || 0) - (a.hook.priority || 0));

    for (const { plugin, hook } of allHooks) {
      let vetoed = false;
      let vetoReason: string | undefined;

      const ctx: import("./types.js").HookContext<T> = {
        data,
        meta: {
          source: plugin,
          timestamp: Date.now(),
        },
        veto: (reason: string) => {
          vetoed = true;
          vetoReason = reason;
        },
        transform: () => {
          throw new Error("Transform not allowed in veto hook");
        },
      };

      try {
        await hook.handler(ctx);
      } catch (error) {
        console.error(`Veto hook error from ${plugin}:`, error);
        continue;
      }

      if (vetoed) {
        return { vetoed: true, reason: vetoReason };
      }
    }

    return { vetoed: false };
  }

  async executeTransform<T>(hookName: string, data: T): Promise<T> {
    let currentData = data;
    const allHooks: Array<{ plugin: string; hook: HookDefinition }> = [];
    
    for (const [pluginName, context] of this.contexts) {
      const hooks = context.getHooks(hookName);
      for (const hook of hooks) {
        if (hook.type === "transform") {
          allHooks.push({ plugin: pluginName, hook });
        }
      }
    }

    // Sort by priority
    allHooks.sort((a, b) => (b.hook.priority || 0) - (a.hook.priority || 0));

    for (const { plugin, hook } of allHooks) {
      let transformed = false;
      let newData: T = currentData;

      const ctx: import("./types.js").HookContext<T> = {
        data: currentData,
        meta: {
          source: plugin,
          timestamp: Date.now(),
        },
        veto: () => {
          throw new Error("Veto not allowed in transform hook");
        },
        transform: (d: T) => {
          transformed = true;
          newData = d;
        },
      };

      try {
        await hook.handler(ctx);
      } catch (error) {
        console.error(`Transform hook error from ${plugin}:`, error);
        continue;
      }

      if (transformed) {
        currentData = newData;
      }
    }

    return currentData;
  }

  async executeObserve<T>(hookName: string, data: T): Promise<void> {
    const allHooks: Array<{ plugin: string; hook: HookDefinition }> = [];
    
    for (const [pluginName, context] of this.contexts) {
      const hooks = context.getHooks(hookName);
      for (const hook of hooks) {
        if (hook.type === "observe") {
          allHooks.push({ plugin: pluginName, hook });
        }
      }
    }

    // Sort by priority
    allHooks.sort((a, b) => (b.hook.priority || 0) - (a.hook.priority || 0));

    for (const { plugin, hook } of allHooks) {
      const ctx: import("./types.js").HookContext<T> = {
        data,
        meta: {
          source: plugin,
          timestamp: Date.now(),
        },
        veto: () => {
          throw new Error("Veto not allowed in observe hook");
        },
        transform: () => {
          throw new Error("Transform not allowed in observe hook");
        },
      };

      try {
        await hook.handler(ctx);
      } catch (error) {
        console.error(`Observe hook error from ${plugin}:`, error);
      }
    }
  }
}
