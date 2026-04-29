// Thin facade over the Rust hook dispatcher (P9-T1).
// Scheduling + execution live in ./scheduler.ts and ./executors.ts.
// This file exposes the legacy HookRegistry API so call sites remain
// untouched while the heavy lifting is done in Rust / delegate modules.

import { HookConfig, HookEvent, HookContext, HookResult, HookChainResult } from "./types.js";
import {
  DedupCache,
  HookExecutor,
  applyGuards,
  generateDedupKey,
  sortByPriority,
} from "./scheduler.js";
import { HookFetch, HookPromptRunner } from "./executors.js";

export { setRhaiEvaluator } from "./scheduler.js";
export type { HookFetch, HookPromptRunner } from "./executors.js";

export interface HookRegistryOptions {
  fetchImpl?: HookFetch;
  promptRunner?: HookPromptRunner;
  defaultRetries?: number;
  now?: () => number;
}

const DEDUP_WINDOW_MS = 500;

const skipResult = (hook: HookConfig, reason: string): HookResult =>
  ({ hook, success: true, skipped: true, skipReason: reason, duration: 0 });

export class HookRegistry {
  private hooks = new Map<HookEvent, HookConfig[]>();
  private fetchImpl?: HookFetch;
  private promptRunner?: HookPromptRunner;
  private defaultRetries: number;
  private now: () => number;
  private dedup: DedupCache;
  private exec: HookExecutor;

  constructor(options: HookRegistryOptions = {}) {
    this.fetchImpl = options.fetchImpl;
    this.promptRunner = options.promptRunner;
    this.defaultRetries = options.defaultRetries ?? 0;
    this.now = options.now ?? (() => Date.now());
    this.dedup = new DedupCache(DEDUP_WINDOW_MS, this.now);
    this.exec = new HookExecutor(this.now, () => this.fetchImpl, () => this.promptRunner, () => this.defaultRetries);
  }

  register(config: HookConfig): void {
    const list = this.hooks.get(config.event) || [];
    list.push(config);
    this.hooks.set(config.event, sortByPriority(list));
  }

  loadFromSettings(settings: Record<string, unknown>): void {
    const hooks = settings.hooks as Record<string, HookConfig[]> | undefined;
    if (!hooks) return;
    for (const [event, configs] of Object.entries(hooks)) {
      for (const c of configs) this.register({ ...c, event: event as HookEvent });
    }
  }

  setFetchImpl(f: HookFetch): void { this.fetchImpl = f; }
  setPromptRunner(r: HookPromptRunner): void { this.promptRunner = r; }
  getHooksFor(event: HookEvent): HookConfig[] { return this.hooks.get(event) || []; }

  async fire(event: HookEvent, context: HookContext): Promise<HookResult[]> {
    const out: HookResult[] = [];
    let rejected = false;
    for (const hook of this.hooks.get(event) || []) {
      if (rejected && hook.skipIfRejected) { out.push(skipResult(hook, "previous hook rejected")); continue; }
      const g = await applyGuards(hook, context);
      if (g.kind === "continue") continue;
      if (g.kind === "skip") { out.push(skipResult(hook, g.reason)); continue; }
      if (g.kind === "error") { out.push({ hook, success: false, output: g.output, duration: 0 }); continue; }

      const dedupOn = hook.dedup !== false;
      const key = generateDedupKey(event, hook, context);
      if (dedupOn) {
        const cached = this.dedup.check(key);
        if (cached) { out.push({ ...cached, skipped: true, skipReason: "deduplicated (cached result)" }); continue; }
      }

      const mode = hook.mode ?? (hook.blocking !== false ? "blocking" : "nonBlocking");
      if (mode === "asyncRewake") {
        out.push(this.exec.dispatchAsyncRewake(event, hook, context));
      } else if (mode === "blocking") {
        const r = await this.exec.runHook(event, hook, context);
        out.push(r);
        if (r.rejected) rejected = true;
        if (dedupOn) this.dedup.record(key, r);
      } else {
        const p = this.exec.runHook(event, hook, context);
        p.catch(() => void 0);
        out.push({ hook, success: true, output: "(non-blocking hook dispatched)", duration: 0 });
        if (dedupOn) p.then(r => this.dedup.record(key, r));
      }
    }
    return out;
  }

  async fireChain(event: HookEvent, initialContext: HookContext): Promise<HookChainResult> {
    const out: HookResult[] = [];
    const ctx = { ...initialContext };
    let rejected = false;
    const startTime = this.now();

    for (const hook of this.hooks.get(event) || []) {
      const g = await applyGuards(hook, ctx);
      if (g.kind === "continue") continue;
      if (g.kind === "skip") { out.push(skipResult(hook, g.reason)); continue; }
      if (g.kind === "error") { out.push({ hook, success: false, output: g.output, duration: 0 }); continue; }

      const hookStart = this.now();
      try {
        let modifiedInput: unknown;
        if (hook.transform && ctx.toolInput) {
          modifiedInput = await hook.transform(ctx.modifiedInput ?? ctx.toolInput, ctx);
          if (modifiedInput && typeof modifiedInput === "object") {
            ctx.modifiedInput = modifiedInput as Record<string, unknown>;
          }
        }
        const output = await this.exec.dispatchByKind(event, hook, ctx, () => { rejected = true; });
        out.push({ hook, success: true, output, modifiedInput, duration: this.now() - hookStart });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        out.push({ hook, success: false, output: msg, rejected: hook.canReject ? true : undefined, duration: this.now() - hookStart });
        if (hook.canReject) rejected = true;
      }
      if (rejected && hook.canReject) break;
    }
    return { results: out, finalInput: ctx.modifiedInput, rejected, totalDuration: this.now() - startTime };
  }

  async rewake(token: string, result: HookResult): Promise<void> { this.exec.rewake(token, result); }
  hasPendingAsyncHooks(): boolean { return this.exec.hasPending(); }
  getPendingAsyncTokens(): string[] { return this.exec.pendingTokens(); }
  awaitAsyncHooks(): Promise<HookResult[]> { return this.exec.awaitPending(); }

  fireSessionStart(c: HookContext): Promise<HookResult[]> { return this.fire("SessionStart", c); }
  fireSessionEnd(c: HookContext): Promise<HookResult[]> { return this.fire("SessionEnd", c); }
  fireUserPromptSubmit(c: HookContext): Promise<HookResult[]> { return this.fire("UserPromptSubmit", c); }
  fireStop(c: HookContext): Promise<HookResult[]> { return this.fire("Stop", c); }
  fireToolError(c: HookContext): Promise<HookResult[]> { return this.fire("OnToolError", c); }
}
