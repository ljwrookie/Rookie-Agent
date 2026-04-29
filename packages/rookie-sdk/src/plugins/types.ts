/**
 * Plugin System Types (P8-T3)
 * 
 * Defines the core interfaces for the Rookie Agent plugin architecture.
 */

import { ToolDefinition, ToolResult } from "../tools/types.js";
import { Skill } from "../skills/types.js";

// ─── Plugin Context ────────────────────────────────────────────────

export interface PluginContext {
  /** Plugin metadata */
  readonly meta: PluginMeta;
  
  /** Plugin configuration */
  readonly config: PluginConfig;
  
  /** Logger instance */
  readonly logger: PluginLogger;
  
  /** Register a new command */
  registerCommand(command: CommandDefinition): void;
  
  /** Register a new tool */
  registerTool(tool: ToolDefinition): void;
  
  /** Register a skill */
  registerSkill(skill: Skill): void;

  /** List all registered skills */
  getAllSkills(): Skill[];
  
  /** Dispatch a tool call */
  dispatchTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  
  /** Subscribe to events */
  onEvent<T = unknown>(event: string, handler: EventHandler<T>): void;
  
  /** Emit an event */
  emitEvent<T = unknown>(event: string, data: T): void;
  
  /** Get shared state (isolated per plugin) */
  getState<T = unknown>(): T;
  
  /** Update shared state */
  setState<T = unknown>(state: T): void;
  
  /** Access other plugins (controlled) */
  getPlugin(name: string): PluginApi | undefined;
  
  /** Register a hook */
  registerHook(hook: HookDefinition): void;
}

export interface PluginMeta {
  /** Plugin name (unique identifier) */
  name: string;
  
  /** Plugin version (semver) */
  version: string;
  
  /** Human-readable description */
  description: string;
  
  /** Plugin author */
  author?: string;
  
  /** Plugin homepage/repository */
  homepage?: string;
  
  /** License */
  license?: string;
  
  /** Minimum Rookie version required */
  rookieVersion?: string;
}

export interface PluginConfig {
  /** Plugin-specific settings */
  settings: Record<string, unknown>;
  
  /** Enabled/disabled */
  enabled: boolean;
  
  /** Permissions granted to this plugin */
  permissions: PluginPermission[];
}

export type PluginPermission =
  | "file:read"
  | "file:write"
  | "network"
  | "shell"
  | "git"
  | "memory:read"
  | "memory:write"
  | "tool:register"
  | "skill:register"
  | "command:register"
  | "hook:register";

// ─── Plugin Definition ─────────────────────────────────────────────

export interface Plugin {
  /** Plugin metadata */
  meta: PluginMeta;
  
  /** Default configuration */
  defaultConfig?: Partial<PluginConfig>;
  
  /** Plugin activation */
  activate(context: PluginContext): void | Promise<void>;
  
  /** Plugin deactivation (cleanup) */
  deactivate?(context: PluginContext): void | Promise<void>;
}

export type PluginFactory = () => Plugin | Promise<Plugin>;

// ─── Command Definition ────────────────────────────────────────────

export interface CommandDefinition {
  /** Command name */
  name: string;
  
  /** Command description */
  description: string;
  
  /** Command aliases */
  aliases?: string[];
  
  /** Arguments schema */
  args?: ArgSchema[];
  
  /** Options schema */
  options?: OptionSchema[];
  
  /** Command handler */
  handler: CommandHandler;
}

export interface ArgSchema {
  name: string;
  description: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "array";
}

export interface OptionSchema {
  name: string;
  description: string;
  alias?: string;
  type?: "string" | "number" | "boolean";
  default?: unknown;
}

export interface CommandContext {
  /** Raw arguments */
  args: string[];
  
  /** Parsed options */
  options: Record<string, unknown>;
  
  /** Working directory */
  cwd: string;
  
  /** Logger */
  logger: PluginLogger;
  
  /** Dispatch a tool */
  dispatchTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export type CommandHandler = (ctx: CommandContext) => void | Promise<void>;

// ─── Hook System ───────────────────────────────────────────────────

export interface HookDefinition {
  /** Hook name */
  name: string;
  
  /** Hook type */
  type: "veto" | "transform" | "observe";
  
  /** Hook handler */
  handler: HookHandler;
  
  /** Priority (higher = earlier execution) */
  priority?: number;
}

export interface HookContext<T = unknown> {
  /** Hook payload */
  data: T;
  
  /** Hook metadata */
  meta: {
    source: string;
    timestamp: number;
    [key: string]: unknown;
  };
  
  /** Veto the operation (veto hooks only) */
  veto(reason: string): void;
  
  /** Transform the data (transform hooks only) */
  transform(newData: T): void;
}

export type HookHandler<T = unknown> = (ctx: HookContext<T>) => void | Promise<void>;

// ─── Event System ──────────────────────────────────────────────────

export type EventHandler<T = unknown> = (data: T, meta: EventMeta) => void | Promise<void>;

export interface EventMeta {
  event: string;
  timestamp: number;
  source: string;
}

// ─── Plugin API (for inter-plugin communication) ───────────────────

export interface PluginApi {
  /** Plugin metadata */
  readonly meta: PluginMeta;
  
  /** Check if plugin is active */
  readonly isActive: boolean;
  
  /** Call a method exposed by the plugin */
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  
  /** Subscribe to plugin events */
  on<T = unknown>(event: string, handler: EventHandler<T>): void;
}

// ─── Logger ────────────────────────────────────────────────────────

export interface PluginLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// ─── Plugin Manifest (for npm packages) ────────────────────────────

export interface PluginManifest {
  /** Manifest version */
  manifestVersion: "1.0";
  
  /** Plugin metadata */
  plugin: PluginMeta;
  
  /** Entry point */
  entry: string;
  
  /** Files to include */
  files?: string[];
  
  /** Default configuration */
  defaultConfig?: Partial<PluginConfig>;
  
  /** Required permissions */
  permissions?: PluginPermission[];
  
  /** Dependencies (other plugins) */
  dependencies?: string[];
  
  /** Optional peer plugins */
  peerPlugins?: string[];
}

// ─── Sandboxed Execution ───────────────────────────────────────────

export interface SandboxOptions {
  /** Allowed globals */
  globals?: string[];
  
  /** Timeout for plugin operations (ms) */
  timeout?: number;
  
  /** Memory limit (MB) */
  memoryLimit?: number;
  
  /** Allowed modules (for require/import) */
  allowedModules?: string[];
  
  /** Blocked modules */
  blockedModules?: string[];
}

export interface SandboxedPlugin {
  /** Original plugin */
  plugin: Plugin;
  
  /** Sandbox options */
  sandbox: SandboxOptions;
  
  /** Resource usage stats */
  stats: {
    memoryUsage: number;
    cpuTime: number;
    apiCalls: number;
  };
}

// ─── Plugin Registry Events ────────────────────────────────────────

export interface PluginRegistryEvents {
  "plugin:loaded": { name: string; manifest: PluginManifest };
  "plugin:activated": { name: string; config: PluginConfig };
  "plugin:deactivated": { name: string; reason?: string };
  "plugin:error": { name: string; error: Error };
  "plugin:unloaded": { name: string };
}
