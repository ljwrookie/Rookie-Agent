import { SessionHarness } from "@rookie/agent-sdk";

export interface ResumeOptions {
  projectRoot?: string;
  sessionId?: string;
}

/**
 * `rookie resume [--session-id id]`
 *
 * Phase-2 Coding: reads `.rookie/progress.md` + `.rookie/features.json` and
 * prints the next actionable state. The actual coding loop is driven by the
 * agent runtime; this command exists so operators (and CI) can inspect where
 * a session will pick up after a context-window break.
 */
export async function runResume(opts: ResumeOptions): Promise<number> {
  const harness = new SessionHarness({
    projectRoot: opts.projectRoot ?? process.cwd(),
  });

  try {
    const state = await harness.resume(opts.sessionId);
    console.log(`✓ Resumed session ${state.sessionId}`);
    console.log(`  Phase:              ${state.phase}`);
    console.log(`  Completed / Total:  ${state.completedFeatures} / ${state.totalFeatures}`);
    if (state.currentFeature) {
      console.log(`  Current feature:    ${state.currentFeature.id} — ${state.currentFeature.description}`);
      if (state.currentFeature.verifyCommand) {
        console.log(`    verify: ${state.currentFeature.verifyCommand}`);
      }
    } else {
      console.log(`  Current feature:    <none pending>`);
    }
    if (state.failedFeatures.length > 0) {
      console.log(`  Failed features:    ${state.failedFeatures.map((f) => f.id).join(", ")}`);
    }
    if (state.progressSummary) {
      console.log(`  Summary:            ${state.progressSummary}`);
    }
    return 0;
  } catch (e) {
    console.error(`Error: ${(e as Error).message}`);
    return 1;
  }
}
