import { exec } from "child_process";
import { promisify } from "util";
import {
  HookConfig,
  HookEvent,
  HookContext,
  HookResult,
  HookChainResult,
  HOOK_PRIORITY_VALUE,
  HookLLMDecision,
} from "./types.js";

const execAsync = promisify(exec);

// ─── Extensibility seams (DI friendly) ──────────────────────────

/** Minimal fetch signature so tests can inject a stub without pulling node-fetch typings. */
export type HookFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

/** Runs an LLM prompt for `prompt`-style hooks. Returns the model's text output. */
export type HookPromptRunner = (
  prompt: string,
  context: HookContext,
  config: HookConfig,
) => Promise<string>;

export interface HookRegistryOptions {
  /** Override the default `globalThis.fetch` used for `url` hooks. */
  fetchImpl?: HookFetch;
  /** Runner used for `prompt` hooks. Omitted = prompt hooks report "no runner configured". */
  promptRunner?: HookPromptRunner;
  /** Default retries for `url` hooks when config.retries is unset. Default 0. */
  defaultRetries?: number;
  /** Clock hook for deterministic timing in tests. */
  now?: () => number;
}

// ─── Default helpers ───────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000;

/** C2: Heuristic: if the model's text says "reject" / "deny" / "block", treat as rejected.
 * @deprecated Use structured JSON output instead (structuredOutput: true)
 */
function promptLooksRejected(output: string): boolean {
  return /\b(reject|deny|denied|block|blocked)\b/i.test(output.trim());
}

/** C2: Default structured output prompt template */
const DEFAULT_STRUCTURED_PROMPT = `You are a security and quality gatekeeper for an AI coding assistant.
Your task is to evaluate whether a proposed tool operation should be allowed.

Respond with a JSON object in this exact format:
{
  "decision": "allow" | "reject",
  "reason": "explanation of your decision"
}

Be concise but thorough in your reasoning.`;

/** C2: Parse structured LLM output */
function parseStructuredOutput(output: string): HookLLMDecision | null {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = output.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : output;

    const parsed = JSON.parse(jsonStr.trim()) as unknown;

    // Validate structure
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "decision" in parsed &&
      (parsed.decision === "allow" || parsed.decision === "reject") &&
      "reason" in parsed &&
      typeof parsed.reason === "string"
    ) {
      return {
        decision: parsed.decision,
        reason: parsed.reason,
        modifiedInput: (parsed as Record<string, unknown>).modifiedInput as Record<string, unknown> | undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── HookRegistry ──────────────────────────────────────────────

/**
 * HookRegistry: manages and fires lifecycle hooks.
 * Hooks are loaded from settings.json and can be:
 *   - shell commands (`command`)
 *   - HTTP webhooks (`url`)
 *   - LLM prompts   (`prompt`, requires injected runner)
 */
export class HookRegistry {
  private hooks = new Map<HookEvent, HookConfig[]>();
  private fetchImpl?: HookFetch;
  private promptRunner?: HookPromptRunner;
  private defaultRetries: number;
  private now: () => number;

  constructor(options: HookRegistryOptions = {}) {
    this.fetchImpl = options.fetchImpl;
    this.promptRunner = options.promptRunner;
    this.defaultRetries = options.defaultRetries ?? 0;
    this.now = options.now ?? (() => Date.now());
  }

  register(config: HookConfig): void {
    const existing = this.hooks.get(config.event) || [];
    existing.push(config);
    // Sort by priority (higher priority first)
    existing.sort((a, b) => {
      const prioA = HOOK_PRIORITY_VALUE[a.priority ?? "normal"];
      const prioB = HOOK_PRIORITY_VALUE[b.priority ?? "normal"];
      return prioB - prioA;
    });
    this.hooks.set(config.event, existing);
  }

  loadFromSettings(settings: Record<string, unknown>): void {
    const hooks = settings.hooks as Record<string, HookConfig[]> | undefined;
    if (!hooks) return;

    for (const [event, configs] of Object.entries(hooks)) {
      for (const config of configs) {
        this.register({ ...config, event: event as HookEvent });
      }
    }
  }

  /** Runtime setters — allow late binding once ModelRouter is up. */
  setFetchImpl(fetchImpl: HookFetch): void { this.fetchImpl = fetchImpl; }
  setPromptRunner(runner: HookPromptRunner): void { this.promptRunner = runner; }

  async fire(event: HookEvent, context: HookContext): Promise<HookResult[]> {
    const configs = this.hooks.get(event) || [];
    const results: HookResult[] = [];
    let anyRejected = false;

    for (const hook of configs) {
      // Check if we should skip due to previous rejection
      if (anyRejected && hook.skipIfRejected) {
        results.push({
          hook,
          success: true,
          skipped: true,
          skipReason: "previous hook rejected",
          duration: 0,
        });
        continue;
      }

      // Check matcher for *ToolUse events
      if (hook.matcher && context.toolName) {
        const pattern = new RegExp(hook.matcher.replace(/\*/g, ".*"));
        if (!pattern.test(context.toolName)) continue;
      }

      // Check condition expression
      if (hook.condition && !this.evaluateCondition(hook.condition, context)) {
        results.push({
          hook,
          success: true,
          skipped: true,
          skipReason: "condition not met",
          duration: 0,
        });
        continue;
      }

      // Check filter function
      if (hook.filter) {
        try {
          const allowed = await hook.filter(context);
          if (!allowed) {
            results.push({
              hook,
              success: true,
              skipped: true,
              skipReason: "filter returned false",
              duration: 0,
            });
            continue;
          }
        } catch (e) {
          results.push({
            hook,
            success: false,
            output: `Filter error: ${e instanceof Error ? e.message : String(e)}`,
            duration: 0,
          });
          continue;
        }
      }

      const mode = hook.mode ?? (hook.blocking !== false ? "blocking" : "nonBlocking");
      const runP = this.runHook(event, hook, context);

      if (mode === "blocking") {
        const result = await runP;
        results.push(result);
        if (result.rejected) {
          anyRejected = true;
        }
      } else if (mode === "asyncRewake") {
        // Async rewake: don't block, but also don't fire-and-forget
        // Store promise for later await if needed
        this.pendingAsyncHooks.set(`${event}:${hook.matcher ?? "*"}`, runP);
        results.push({
          hook,
          success: true,
          output: "(async rewake hook dispatched)",
          duration: 0,
        });
      } else {
        // Non-blocking / fire-and-forget
        runP.catch(() => void 0);
        results.push({
          hook,
          success: true,
          output: "(non-blocking hook dispatched)",
          duration: 0,
        });
      }
    }

    return results;
  }

  private pendingAsyncHooks = new Map<string, Promise<HookResult>>();

  /**
   * Wait for all pending async rewake hooks to complete.
   */
  async awaitAsyncHooks(): Promise<HookResult[]> {
    const results = await Promise.all(this.pendingAsyncHooks.values());
    this.pendingAsyncHooks.clear();
    return results;
  }

  /** Convenience wrappers for non-tool events — keep call sites short. */
  async fireSessionStart(context: HookContext): Promise<HookResult[]> { return this.fire("SessionStart", context); }
  async fireSessionEnd(context: HookContext): Promise<HookResult[]> { return this.fire("SessionEnd", context); }
  async fireUserPromptSubmit(context: HookContext): Promise<HookResult[]> { return this.fire("UserPromptSubmit", context); }
  async fireStop(context: HookContext): Promise<HookResult[]> { return this.fire("Stop", context); }
  async fireToolError(context: HookContext): Promise<HookResult[]> { return this.fire("OnToolError", context); }

  getHooksFor(event: HookEvent): HookConfig[] {
    return this.hooks.get(event) || [];
  }

  /**
   * Fire hooks in a chain, passing modifiedInput from one hook to the next.
   * This is the main entry point for PreToolUse hooks that need to transform input.
   */
  async fireChain(event: HookEvent, initialContext: HookContext): Promise<HookChainResult> {
    const configs = this.hooks.get(event) || [];
    const results: HookResult[] = [];
    let currentContext = { ...initialContext };
    let anyRejected = false;
    const startTime = this.now();

    for (const hook of configs) {
      // Check matcher
      if (hook.matcher && currentContext.toolName) {
        const pattern = new RegExp(hook.matcher.replace(/\*/g, ".*"));
        if (!pattern.test(currentContext.toolName)) continue;
      }

      // Check condition
      if (hook.condition && !this.evaluateCondition(hook.condition, currentContext)) {
        results.push({
          hook,
          success: true,
          skipped: true,
          skipReason: "condition not met",
          duration: 0,
        });
        continue;
      }

      // Check filter
      if (hook.filter) {
        try {
          const allowed = await hook.filter(currentContext);
          if (!allowed) {
            results.push({
              hook,
              success: true,
              skipped: true,
              skipReason: "filter returned false",
              duration: 0,
            });
            continue;
          }
        } catch (e) {
          results.push({
            hook,
            success: false,
            output: `Filter error: ${e instanceof Error ? e.message : String(e)}`,
            duration: 0,
          });
          continue;
        }
      }

      // Run the hook
      const hookStart = this.now();
      try {
        let output: string;
        let modifiedInput: unknown | undefined;

        // Apply transform if present
        if (hook.transform && currentContext.toolInput) {
          const input = currentContext.modifiedInput ?? currentContext.toolInput;
          modifiedInput = await hook.transform(input, currentContext);
          // Update context for next hook
          if (modifiedInput && typeof modifiedInput === "object") {
            currentContext.modifiedInput = modifiedInput as Record<string, unknown>;
          }
        }

        if (hook.command) {
          output = await this.runShell(event, hook, currentContext);
        } else if (hook.url) {
          output = await this.runHttp(hook, currentContext);
        } else if (hook.prompt) {
          const promptResult = await this.runPrompt(hook, currentContext);
          output = promptResult.output;
          if (promptResult.rejected) {
            anyRejected = true;
          }
        } else if (hook.transform) {
          output = "transform applied";
        } else {
          output = "Hook has no command/url/prompt/transform configured";
        }

        results.push({
          hook,
          success: true,
          output,
          modifiedInput,
          duration: this.now() - hookStart,
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        results.push({
          hook,
          success: false,
          output: error,
          rejected: hook.canReject ? true : undefined,
          duration: this.now() - hookStart,
        });
        if (hook.canReject) {
          anyRejected = true;
        }
      }

      // Check if we should stop due to rejection
      if (anyRejected && hook.canReject) {
        break;
      }
    }

    return {
      results,
      finalInput: currentContext.modifiedInput,
      rejected: anyRejected,
      totalDuration: this.now() - startTime,
    };
  }

  // ── Internal: dispatch one hook config ──────────────────────

  private async runHook(event: HookEvent, hook: HookConfig, context: HookContext): Promise<HookResult> {
    const start = this.now();

    // Check trust level
    if (this.shouldSkipDueToTrust(hook, context)) {
      return {
        hook,
        success: true,
        skipped: true,
        skipReason: "trust level insufficient",
        duration: this.now() - start,
      };
    }

    try {
      let output: string;
      let modifiedInput: unknown | undefined;

      if (hook.transform && context.toolInput) {
        // Transform hook: modify input
        const input = context.modifiedInput ?? context.toolInput;
        modifiedInput = await hook.transform(input, context);
      }

      if (hook.command) {
        output = await this.runShell(event, hook, context);
      } else if (hook.url) {
        output = await this.runHttp(hook, context);
      } else if (hook.prompt) {
        const promptResult = await this.runPrompt(hook, context);
        output = promptResult.output;
        const rejected = hook.canReject ? promptResult.rejected : undefined;
        return {
          hook,
          success: !rejected,
          rejected,
          output,
          modifiedInput,
          duration: this.now() - start,
        };
      } else if (hook.transform) {
        // Transform-only hook
        return {
          hook,
          success: true,
          output: "transform applied",
          modifiedInput,
          duration: this.now() - start,
        };
      } else {
        return {
          hook,
          success: false,
          output: "Hook has no command/url/prompt/transform configured",
          duration: this.now() - start,
        };
      }

      return {
        hook,
        success: true,
        output,
        modifiedInput,
        duration: this.now() - start,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        hook,
        success: false,
        output: error,
        rejected: hook.canReject ? true : undefined,
        duration: this.now() - start,
      };
    }
  }

  /**
   * Evaluate condition expression against context.
   * Supports simple expressions like: "toolName == 'file_write'", "event == 'PreToolUse'"
   */
  private evaluateCondition(condition: string, context: HookContext): boolean {
    try {
      // Simple expression evaluator
      // Replace context variable references with actual values
      const normalized = condition
        .replace(/toolName\s*==\s*['"]([^'"]+)['"]/g, (_, name) =>
          context.toolName === name ? "true" : "false")
        .replace(/event\s*==\s*['"]([^'"]+)['"]/g, (_, evt) =>
          evt === "*" ? "true" : "false")
        .replace(/sessionId\s*==\s*['"]([^'"]+)['"]/g, (_, id) =>
          context.sessionId === id ? "true" : "false");

      // Handle simple boolean expressions
      if (normalized === "true") return true;
      if (normalized === "false") return false;

      // Default: evaluate as JavaScript (be careful with security)
      // For production, use a proper expression parser
      return Function(`"use strict"; return (${normalized})`)();
    } catch {
      // If evaluation fails, allow the hook to run (fail open)
      return true;
    }
  }

  /**
   * Check if hook should be skipped due to trust level.
   */
  private shouldSkipDueToTrust(hook: HookConfig, context: HookContext): boolean {
    const trustLevel = hook.trustLevel ?? "untrusted";
    const contextTrust = context.trustDecision?.trusted ?? false;

    // Critical hooks require explicit trust
    if (trustLevel === "trusted" && !contextTrust) {
      return true;
    }

    return false;
  }

  // ── Shell ──────────────────────────────────────────────────

  private async runShell(event: HookEvent, hook: HookConfig, context: HookContext): Promise<string> {
    const env: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][]
      ),
      ROOKIE_SESSION_ID: context.sessionId,
      ROOKIE_TOOL_NAME: context.toolName || "",
      ROOKIE_TOOL_OUTPUT: context.toolOutput || "",
      ROOKIE_PROJECT_ROOT: context.projectRoot,
      ROOKIE_HOOK_EVENT: event,
    };

    if (context.toolInput) {
      for (const [key, value] of Object.entries(context.toolInput)) {
        env[`ROOKIE_TOOL_INPUT_${key.toUpperCase()}`] = String(value);
      }
    }

    const { stdout } = await execAsync(hook.command!, {
      env,
      timeout: hook.timeout || DEFAULT_TIMEOUT,
      cwd: context.projectRoot,
    });

    return stdout;
  }

  // ── HTTP ───────────────────────────────────────────────────

  private async runHttp(hook: HookConfig, context: HookContext): Promise<string> {
    const fetchImpl = this.fetchImpl ?? (globalThis.fetch as unknown as HookFetch | undefined);
    if (!fetchImpl) {
      throw new Error("HTTP hook requires fetch; none configured and globalThis.fetch unavailable");
    }

    const method = hook.method ?? "POST";
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...(hook.headers ?? {}),
    };
    const body = method === "GET" ? undefined : JSON.stringify({ event: hook.event, context });
    const retries = Math.max(0, hook.retries ?? this.defaultRetries);

    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), hook.timeout ?? DEFAULT_TIMEOUT);

      try {
        const res = await fetchImpl(hook.url!, {
          method,
          headers,
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const text = await res.text();
        if (!res.ok) {
          // 4xx is a deterministic failure — do not retry.
          if (res.status < 500) {
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
          }
          // 5xx — retry if we still have attempts left.
          lastError = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
          if (attempt < retries) continue;
          throw lastError;
        }
        return text;
      } catch (e) {
        clearTimeout(timer);
        // If the error carries an HTTP status < 500, bubble up immediately.
        const msg = e instanceof Error ? e.message : String(e);
        if (/^HTTP [1-4]\d\d:/.test(msg)) throw e;
        lastError = e;
        if (attempt >= retries) throw e;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  // ── LLM prompt ─────────────────────────────────────────────

  private async runPrompt(
    hook: HookConfig,
    context: HookContext,
  ): Promise<{ output: string; rejected: boolean; decision?: HookLLMDecision }> {
    if (!this.promptRunner) {
      throw new Error("LLM prompt hook requires a promptRunner; none configured");
    }

    // C2: Use structured output if enabled
    const useStructured = hook.structuredOutput !== false; // Default to structured

    // Prepend structured output instructions if using structured mode
    let prompt = hook.prompt!;
    if (useStructured && !prompt.includes("decision")) {
      prompt = `${DEFAULT_STRUCTURED_PROMPT}\n\n${prompt}`;
    }

    const output = await this.promptRunner(prompt, context, hook);

    // C2: Try structured parsing first
    if (useStructured) {
      const decision = parseStructuredOutput(output);
      if (decision) {
        return {
          output: `${decision.decision.toUpperCase()}: ${decision.reason}`,
          rejected: hook.canReject === true && decision.decision === "reject",
          decision,
        };
      }
      // Fallback to legacy regex if JSON parsing fails
      console.warn("[HookRegistry] Failed to parse structured output, falling back to regex:", output.slice(0, 200));
    }

    // Legacy regex-based rejection detection
    const rejected = hook.canReject === true && promptLooksRejected(output);
    return { output, rejected };
  }
}
