// Scheduling primitives: matcher, condition evaluation, dedup.
// Priority sorting, chain short-circuit and async rewake bookkeeping are kept
// here so registry.ts stays a thin facade. The heavy lifting (priority queue,
// FIFO ordering, timeout-aware dispatch) is implemented in Rust
// (crates/rookie-core/src/hook/dispatch.rs) and exposed via NAPI when
// available. This TS layer provides a pure fallback and the JS-host-only
// transports (shell/http/prompt).

import { createHash } from "crypto";
import {
  HookConfig,
  HookContext,
  HookEvent,
  HookResult,
  PendingAsyncHook,
  HOOK_PRIORITY_VALUE,
} from "./types.js";
import { DEFAULT_TIMEOUT, HookFetch, HookPromptRunner, runHttp, runPrompt, runShell } from "./executors.js";

let rhaiEvaluator: { evaluate: (expression: string, contextJson: string) => Promise<boolean> } | null = null;

export function setRhaiEvaluator(
  evaluator: { evaluate: (expression: string, contextJson: string) => Promise<boolean> },
): void {
  rhaiEvaluator = evaluator;
}

export async function evaluateCondition(condition: string, context: HookContext): Promise<boolean> {
  const contextJson = JSON.stringify({
    toolName: context.toolName || "",
    toolInput: context.toolInput || {},
    toolOutput: context.toolOutput || "",
    sessionId: context.sessionId,
    projectRoot: context.projectRoot,
    event: (context as unknown as { event?: string }).event || "",
    trustDecision: context.trustDecision,
  });
  try {
    if (rhaiEvaluator) return await rhaiEvaluator.evaluate(condition, contextJson);
    // Fallback: a tiny safe matcher used when Rust NAPI is not loaded.
    const ctx = JSON.parse(contextJson) as Record<string, unknown>;
    const eq = condition.match(/^(\w+)\s*==\s*['"]([^'"]+)['"]$/);
    if (eq) return ctx[eq[1]] === eq[2];
    const contains = condition.match(/contains\((\w+),\s*['"]([^'"]+)['"]\)/);
    if (contains) {
      const v = ctx[contains[1]];
      return typeof v === "string" && v.includes(contains[2]);
    }
    return true;
  } catch {
    return true;
  }
}

export function matchesMatcher(pattern: string | undefined, toolName: string | undefined): boolean {
  if (!pattern || !toolName) return true;
  return new RegExp(pattern.replace(/\*/g, ".*")).test(toolName);
}

export function sortByPriority(hooks: HookConfig[]): HookConfig[] {
  return [...hooks].sort((a, b) => {
    const pa = HOOK_PRIORITY_VALUE[a.priority ?? "normal"];
    const pb = HOOK_PRIORITY_VALUE[b.priority ?? "normal"];
    return pb - pa;
  });
}

export function generateDedupKey(event: string, hook: HookConfig, context: HookContext): string {
  if (hook.dedupKey) return `${event}::${hook.dedupKey(context)}`;
  const inputHash = createHash("sha256")
    .update(JSON.stringify(context.toolInput ?? {}))
    .digest("hex")
    .slice(0, 16);
  return `${event}::${hook.matcher ?? "*"}::${inputHash}`;
}

export class DedupCache {
  private store = new Map<string, { timestamp: number; result: HookResult }>();
  constructor(private windowMs: number, private now: () => number) {}

  check(key: string): HookResult | undefined {
    const entry = this.store.get(key);
    if (entry && this.now() - entry.timestamp < this.windowMs) return entry.result;
    return undefined;
  }

  record(key: string, result: HookResult): void {
    this.store.set(key, { timestamp: this.now(), result });
    if (this.store.size > 1000) {
      const cutoff = this.now() - this.windowMs;
      for (const [k, v] of this.store) if (v.timestamp < cutoff) this.store.delete(k);
    }
  }
}

export function shouldSkipDueToTrust(hook: HookConfig, context: HookContext): boolean {
  const trustLevel = hook.trustLevel ?? "untrusted";
  const contextTrust = context.trustDecision?.trusted ?? false;
  return trustLevel === "trusted" && !contextTrust;
}

export type GuardOutcome =
  | { kind: "pass" }
  | { kind: "continue" }
  | { kind: "skip"; reason: string }
  | { kind: "error"; output: string };

/**
 * Pre-flight guards shared by fire() and fireChain(): matcher, condition,
 * filter. Returns a discriminated outcome so callers can push a skip result
 * or continue execution. `continue` means silently skip (matcher mismatch).
 */
export async function applyGuards(hook: HookConfig, context: HookContext): Promise<GuardOutcome> {
  if (!matchesMatcher(hook.matcher, context.toolName)) return { kind: "continue" };
  if (hook.condition && !(await evaluateCondition(hook.condition, context))) {
    return { kind: "skip", reason: "condition not met" };
  }
  if (hook.filter) {
    try {
      if (!(await hook.filter(context))) return { kind: "skip", reason: "filter returned false" };
    } catch (e) {
      return { kind: "error", output: `Filter error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  return { kind: "pass" };
}

/**
 * Executes a single resolved hook. Owns async-rewake bookkeeping so the
 * facade registry can stay tiny. Transport execution (shell/http/prompt) is
 * delegated to ./executors.ts.
 */
export class HookExecutor {
  private pending = new Map<string, PendingAsyncHook>();
  private results = new Map<string, HookResult>();
  private counter = 0;

  constructor(
    private now: () => number,
    private fetchImpl: () => HookFetch | undefined,
    private promptRunner: () => HookPromptRunner | undefined,
    private defaultRetries: () => number,
  ) {}

  async runHook(event: HookEvent, hook: HookConfig, context: HookContext): Promise<HookResult> {
    const start = this.now();
    if (shouldSkipDueToTrust(hook, context)) {
      return { hook, success: true, skipped: true, skipReason: "trust level insufficient", duration: this.now() - start };
    }
    try {
      let modifiedInput: unknown;
      if (hook.transform && context.toolInput) {
        modifiedInput = await hook.transform(context.modifiedInput ?? context.toolInput, context);
      }
      let rejected: boolean | undefined;
      const output = await this.dispatchByKind(event, hook, context, () => { rejected = true; });
      return { hook, success: rejected !== true, rejected: hook.canReject ? rejected : undefined, output, modifiedInput, duration: this.now() - start };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { hook, success: false, output: msg, rejected: hook.canReject ? true : undefined, duration: this.now() - start };
    }
  }

  async dispatchByKind(
    event: HookEvent, hook: HookConfig, context: HookContext, markRejected: () => void,
  ): Promise<string> {
    if (hook.command) return runShell(event, hook, context);
    if (hook.url) return runHttp(hook, context, this.fetchImpl(), this.defaultRetries());
    if (hook.prompt) {
      const r = await runPrompt(hook, context, this.promptRunner());
      if (r.rejected) markRejected();
      return r.output;
    }
    if (hook.transform) return "transform applied";
    return "Hook has no command/url/prompt/transform configured";
  }

  dispatchAsyncRewake(event: HookEvent, hook: HookConfig, context: HookContext): HookResult {
    const token = `rewake_${++this.counter}_${this.now().toString(36)}`;
    const pending: PendingAsyncHook = { token, hook, context, startTime: this.now(), resolve: () => {}, reject: () => {} };
    const promise = new Promise<HookResult>((resolve, reject) => { pending.resolve = resolve; pending.reject = reject; });
    (pending as unknown as { promise: Promise<HookResult> }).promise = promise;
    this.pending.set(token, pending);
    this.runHook(event, hook, context)
      .then(r => { if (this.pending.has(token)) this.rewake(token, { ...r, async: true, rewakeToken: token }); })
      .catch(err => {
        if (this.pending.has(token)) {
          pending.reject(err instanceof Error ? err : new Error(String(err)));
          this.pending.delete(token);
        }
      });
    return { hook, success: true, output: `(async rewake hook dispatched, token: ${token})`, duration: 0, async: true, rewakeToken: token };
  }

  rewake(token: string, result: HookResult): void {
    const p = this.pending.get(token);
    if (!p) throw new Error(`No pending async hook found for token: ${token}`);
    p.resolve(result);
    this.results.set(token, result);
    this.pending.delete(token);
  }

  hasPending(): boolean { return this.pending.size > 0; }
  pendingTokens(): string[] { return Array.from(this.pending.keys()); }

  async awaitPending(): Promise<HookResult[]> {
    const ps = Array.from(this.pending.values()).map(p => new Promise<HookResult>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Async hook ${p.token} timed out`)), p.hook.timeout ?? DEFAULT_TIMEOUT);
      const orig = p.resolve;
      p.resolve = (r: HookResult) => { clearTimeout(timer); orig(r); resolve(r); };
    }));
    const settled = await Promise.allSettled(ps);
    this.pending.clear();
    return settled.filter((r): r is PromiseFulfilledResult<HookResult> => r.status === "fulfilled").map(r => r.value);
  }
}
