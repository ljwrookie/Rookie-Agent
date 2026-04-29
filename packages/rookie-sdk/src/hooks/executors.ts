// Hook transport executors.
// These are JS-host-required code paths (shell / HTTP / LLM prompt).
// Pure scheduling logic (priority, dedup, async rewake, matcher) lives in
// the Rust HookDispatcher (crates/rookie-core/src/hook/dispatch.rs).

import { exec } from "child_process";
import { promisify } from "util";
import { HookConfig, HookContext, HookEvent, HookLLMDecision } from "./types.js";

const execAsync = promisify(exec);

export const DEFAULT_TIMEOUT = 30_000;

export type HookFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export type HookPromptRunner = (
  prompt: string,
  context: HookContext,
  config: HookConfig,
) => Promise<string>;

const DEFAULT_STRUCTURED_PROMPT = `You are a security and quality gatekeeper for an AI coding assistant.
Your task is to evaluate whether a proposed tool operation should be allowed.

Respond with a JSON object in this exact format:
{
  "decision": "allow" | "reject",
  "reason": "explanation of your decision"
}

Be concise but thorough in your reasoning.`;

export function parseStructuredOutput(output: string): HookLLMDecision | null {
  try {
    const jsonMatch = output.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : output;
    const parsed = JSON.parse(jsonStr.trim()) as unknown;
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

export function promptLooksRejected(output: string): boolean {
  return /\b(reject|deny|denied|block|blocked)\b/i.test(output.trim());
}

export async function runShell(event: HookEvent, hook: HookConfig, context: HookContext): Promise<string> {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
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

export async function runHttp(
  hook: HookConfig,
  context: HookContext,
  fetchImpl: HookFetch | undefined,
  defaultRetries: number,
): Promise<string> {
  const impl = fetchImpl ?? (globalThis.fetch as unknown as HookFetch | undefined);
  if (!impl) {
    throw new Error("HTTP hook requires fetch; none configured and globalThis.fetch unavailable");
  }
  const method = hook.method ?? "POST";
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(hook.headers ?? {}),
  };
  const body = method === "GET" ? undefined : JSON.stringify({ event: hook.event, context });
  const retries = Math.max(0, hook.retries ?? defaultRetries);

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), hook.timeout ?? DEFAULT_TIMEOUT);
    try {
      const res = await impl(hook.url!, { method, headers, body, signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) {
        if (res.status < 500) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        lastError = new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        if (attempt < retries) continue;
        throw lastError;
      }
      return text;
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      if (/^HTTP [1-4]\d\d:/.test(msg)) throw e;
      lastError = e;
      if (attempt >= retries) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runPrompt(
  hook: HookConfig,
  context: HookContext,
  promptRunner: HookPromptRunner | undefined,
): Promise<{ output: string; rejected: boolean; decision?: HookLLMDecision }> {
  if (!promptRunner) throw new Error("LLM prompt hook requires a promptRunner; none configured");
  const useStructured = hook.structuredOutput !== false;
  let prompt = hook.prompt!;
  if (useStructured && !prompt.includes("decision")) {
    prompt = `${DEFAULT_STRUCTURED_PROMPT}\n\n${prompt}`;
  }
  const output = await promptRunner(prompt, context, hook);
  if (useStructured) {
    const decision = parseStructuredOutput(output);
    if (decision) {
      return {
        output: `${decision.decision.toUpperCase()}: ${decision.reason}`,
        rejected: hook.canReject === true && decision.decision === "reject",
        decision,
      };
    }
  }
  return { output, rejected: hook.canReject === true && promptLooksRejected(output) };
}
