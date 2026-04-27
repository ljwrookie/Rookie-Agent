// Session Harness types (from Anthropic Harness)

import type { HookRegistry } from "../hooks/registry.js";

export interface InitOptions {
  projectRoot: string;
  progressFile?: string;        // default: .rookie/progress.md
  featureListFile?: string;     // default: .rookie/features.json
  verifyCommand?: string;       // e.g. "npm test"
  maxFeaturesPerSession?: number;
  /** Optional hook registry — enables PreCheckpoint / PostCheckpoint firing. */
  hooks?: HookRegistry;
  /** Session id threaded into HookContext. Defaults to "harness". */
  sessionId?: string;
}

export interface SessionState {
  sessionId: string;
  phase: "initializer" | "coding";
  totalFeatures: number;
  completedFeatures: number;
  currentFeature: Feature | null;
  failedFeatures: Feature[];
  progressSummary: string;
  gitLogSummary: string;
}

export interface Feature {
  id: string;
  description: string;
  verifyCommand?: string;
  status: "pending" | "in_progress" | "passed" | "failed" | "skipped";
  attempts: number;
  lastError?: string;
}

export interface CheckpointData {
  feature: Feature;
  commitMessage: string;
  progressUpdate: string;
}

export interface VerificationResult {
  passed: boolean;
  output: string;
  duration: number;
}
