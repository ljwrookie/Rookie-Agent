import { exec } from "child_process";
import { promisify } from "util";
import {
  InitOptions,
  SessionState,
  CheckpointData,
  Feature,
  VerificationResult,
} from "./types.js";
import { ProgressManager, ProgressData } from "./progress.js";
import { FeatureListManager } from "./features.js";

const execAsync = promisify(exec);

/**
 * SessionHarness: manages long-running task continuity across context windows.
 *
 * Implements the Anthropic Harness dual-phase strategy:
 *   Phase 1 (Initializer): decompose task → feature list → progress file
 *   Phase 2 (Coding): read progress + git log → resume → implement → checkpoint
 */
export class SessionHarness {
  private progress: ProgressManager;
  private features: FeatureListManager;
  private options: InitOptions;

  constructor(options?: InitOptions) {
    const projectRoot = options?.projectRoot || process.cwd();
    this.options = {
      projectRoot,
      progressFile: "progress.md",
      featureListFile: "features.json",
      maxFeaturesPerSession: 10,
      ...options,
    };
    this.progress = new ProgressManager(projectRoot, this.options.progressFile);
    this.features = new FeatureListManager(projectRoot, this.options.featureListFile);
  }

  /**
   * Phase 1 — Initializer Agent.
   * Called in the first context window to decompose the task.
   */
  async initialize(task: string, features: Feature[]): Promise<SessionState> {
    const sessionId = `init_${Date.now().toString(36)}`;

    // Create feature list
    await this.features.create(task, features);

    // Create progress file
    const env = await this.detectEnvironment();
    const progressData: ProgressData = {
      taskName: task.slice(0, 80),
      taskDescription: task,
      environment: env,
      completed: [],
      inProgress: [],
      pending: features.map((f) => ({
        featureId: f.id,
        description: f.description,
      })),
      knownIssues: [],
      lastSessionSummary: `Session ${sessionId}: Initialized task with ${features.length} features.`,
    };
    await this.progress.write(progressData);

    // Git commit the initialization
    try {
      await execAsync(
        `cd "${this.options.projectRoot}" && git add .rookie/ && git commit -m "rookie: initialize task - ${task.slice(0, 50)}" --allow-empty`,
        { timeout: 10000 }
      );
    } catch {
      // Git commit is best-effort
    }

    return {
      sessionId,
      phase: "initializer",
      totalFeatures: features.length,
      completedFeatures: 0,
      currentFeature: null,
      failedFeatures: [],
      progressSummary: `Initialized ${features.length} features`,
      gitLogSummary: "",
    };
  }

  /**
   * Phase 2 — Coding Agent.
   * Called in subsequent context windows to resume work.
   */
  async resume(sessionId?: string): Promise<SessionState> {
    const resolvedSessionId = sessionId || `code_${Date.now().toString(36)}`;

    // Read progress
    const progressData = await this.progress.read();
    const featureList = await this.features.read();

    if (!progressData || !featureList) {
      throw new Error(
        "No progress or feature list found. Run `rookie init` first to decompose the task."
      );
    }

    // Read recent git log for context recovery
    let gitLogSummary = "";
    try {
      const { stdout } = await execAsync(
        `cd "${this.options.projectRoot}" && git log --oneline -20 2>/dev/null`,
        { timeout: 5000 }
      );
      gitLogSummary = stdout.trim();
    } catch {
      // Git log is best-effort
    }

    // Determine current state
    const completed = featureList.features.filter((f) => f.status === "passed");
    const failed = featureList.features.filter(
      (f) => f.status === "failed" || f.status === "skipped"
    );
    const current =
      featureList.features.find((f) => f.status === "in_progress") || null;
    const nextPending =
      featureList.features.find((f) => f.status === "pending") || null;

    return {
      sessionId: resolvedSessionId,
      phase: "coding",
      totalFeatures: featureList.features.length,
      completedFeatures: completed.length,
      currentFeature: current || nextPending,
      failedFeatures: failed,
      progressSummary: progressData.lastSessionSummary,
      gitLogSummary,
    };
  }

  /**
   * Save a checkpoint after completing a feature.
   * Updates progress file, feature list, and creates a git commit.
   *
   * Fires `PreCheckpoint` before writes; a hook marked `canReject` that
   * throws/returns non-zero aborts the checkpoint. `PostCheckpoint` fires
   * after the git commit (whether the commit itself succeeded or not).
   */
  async checkpoint(data: CheckpointData): Promise<void> {
    const { feature, commitMessage, progressUpdate } = data;

    // ── PreCheckpoint hooks (can reject) ─────────────────────
    if (this.options.hooks) {
      const results = await this.options.hooks.fire("PreCheckpoint", {
        sessionId: this.options.sessionId || "harness",
        projectRoot: this.options.projectRoot,
        toolInput: {
          feature_id: feature.id,
          feature_status: feature.status,
          commit_message: commitMessage,
        },
      });
      for (const r of results) {
        if (r.rejected) {
          throw new Error(`PreCheckpoint hook rejected: ${r.output || "no reason"}`);
        }
      }
    }

    // Update feature status
    await this.features.updateStatus(feature.id, feature.status, feature.lastError);

    // Update progress file
    if (feature.status === "passed") {
      await this.progress.markCompleted(feature.id, `checkpoint_${Date.now()}`);
    }
    await this.progress.updateSessionSummary(progressUpdate);

    // Git commit
    try {
      await execAsync(
        `cd "${this.options.projectRoot}" && git add -A && git commit -m "${commitMessage.replace(/"/g, '\\"')}"`,
        { timeout: 30000 }
      );
    } catch {
      // Git commit is best-effort
    }

    // ── PostCheckpoint hooks (observational) ─────────────────
    if (this.options.hooks) {
      await this.options.hooks.fire("PostCheckpoint", {
        sessionId: this.options.sessionId || "harness",
        projectRoot: this.options.projectRoot,
        toolInput: {
          feature_id: feature.id,
          feature_status: feature.status,
          commit_message: commitMessage,
        },
        toolOutput: progressUpdate,
      });
    }
  }

  /**
   * Verify a feature by running its verification command.
   */
  async verify(feature: Feature): Promise<VerificationResult> {
    const command = feature.verifyCommand || this.options.verifyCommand;
    if (!command) {
      return {
        passed: true,
        output: "No verification command specified — assuming passed.",
        duration: 0,
      };
    }

    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(
        `cd "${this.options.projectRoot}" && ${command}`,
        { timeout: 120000, maxBuffer: 2 * 1024 * 1024 }
      );
      const duration = Date.now() - start;
      return {
        passed: true,
        output: (stdout + (stderr ? `\n[stderr] ${stderr}` : "")).trim(),
        duration,
      };
    } catch (e) {
      const duration = Date.now() - start;
      const error = e instanceof Error ? (e as any).stderr || e.message : String(e);
      return {
        passed: false,
        output: String(error).slice(0, 2000),
        duration,
      };
    }
  }

  /**
   * Run the full coding loop: pick next feature → implement → verify → checkpoint.
   * Returns an async generator of status updates.
   */
  async *runCodingLoop(): AsyncGenerator<CodingLoopEvent> {
    const maxPerSession = this.options.maxFeaturesPerSession || 10;
    let completed = 0;

    while (completed < maxPerSession) {
      // Get next feature
      const feature = await this.features.getNextPending();
      if (!feature) {
        yield { type: "all_done", message: "All features completed or skipped." };
        return;
      }

      yield { type: "feature_start", feature };

      // Mark in progress
      await this.features.updateStatus(feature.id, "in_progress");
      await this.progress.markInProgress(feature.id);

      // Yield control to the caller (agent) to implement
      yield { type: "implement", feature };

      // After implementation, verify
      const result = await this.verify(feature);
      yield { type: "verify_result", feature, result };

      if (result.passed) {
        feature.status = "passed";
        await this.checkpoint({
          feature,
          commitMessage: `feat: ${feature.description}`,
          progressUpdate: `Completed ${feature.id}: ${feature.description}`,
        });
        completed++;
        yield { type: "feature_done", feature };
      } else {
        feature.attempts++;
        if (feature.attempts >= 3) {
          feature.status = "skipped";
          feature.lastError = result.output;
          await this.features.updateStatus(feature.id, "skipped", result.output);
          yield { type: "feature_skipped", feature, reason: "Max attempts (3) reached" };
        } else {
          feature.status = "failed";
          feature.lastError = result.output;
          await this.features.updateStatus(feature.id, "failed", result.output);
          yield { type: "feature_failed", feature, error: result.output };
          // Re-queue: set back to pending for retry
          await this.features.updateStatus(feature.id, "pending");
        }
      }
    }

    yield { type: "session_limit", message: `Reached session limit of ${maxPerSession} features.` };
  }

  // ── Internal helpers ─────────────────────────────────────

  private async detectEnvironment(): Promise<Record<string, string>> {
    const env: Record<string, string> = {};

    // Detect package manager
    const checks = [
      { file: "pnpm-lock.yaml", value: "pnpm" },
      { file: "yarn.lock", value: "yarn" },
      { file: "package-lock.json", value: "npm" },
      { file: "Cargo.toml", value: "cargo" },
      { file: "go.mod", value: "go" },
      { file: "pyproject.toml", value: "pip/poetry" },
    ];

    const fsP = await import("fs/promises");
    const pathM = await import("path");

    for (const check of checks) {
      try {
        await fsP.access(pathM.join(this.options.projectRoot, check.file));
        env["Package Manager"] = check.value;
        break;
      } catch {
        // continue
      }
    }

    // Detect project type from files
    try {
      await fsP.access(pathM.join(this.options.projectRoot, "package.json"));
      const pkg = JSON.parse(
        await fsP.readFile(pathM.join(this.options.projectRoot, "package.json"), "utf-8")
      );
      if (pkg.scripts?.build) env["Build Command"] = `${env["Package Manager"] || "npm"} run build`;
      if (pkg.scripts?.test) env["Test Command"] = `${env["Package Manager"] || "npm"} test`;
    } catch {
      // no package.json
    }

    try {
      await fsP.access(pathM.join(this.options.projectRoot, "Cargo.toml"));
      env["Build Command"] = env["Build Command"] || "cargo build";
      env["Test Command"] = env["Test Command"] || "cargo test";
      env["Project Type"] = (env["Project Type"] || "") + " Rust";
    } catch {
      // no Cargo.toml
    }

    return env;
  }
}

// ── Event types for the coding loop ─────────────────────────

export type CodingLoopEvent =
  | { type: "feature_start"; feature: Feature }
  | { type: "implement"; feature: Feature }
  | { type: "verify_result"; feature: Feature; result: VerificationResult }
  | { type: "feature_done"; feature: Feature }
  | { type: "feature_failed"; feature: Feature; error: string }
  | { type: "feature_skipped"; feature: Feature; reason: string }
  | { type: "all_done"; message: string }
  | { type: "session_limit"; message: string };
