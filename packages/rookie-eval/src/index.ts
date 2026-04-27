// Eval Harness exports (P2-T3)

export {
  EvalHarness,
  type EvalHarnessOptions,
} from "./harness.js";

export type {
  BenchmarkCase,
  BenchmarkSuite,
  BenchmarkResult,
  BenchmarkRun,
  ComparisonResult,
} from "./types.js";

// Self-optimization Pipeline exports (P2-T5)
export {
  SelfOptimizer,
  PromptMutator,
  type OptimizationRun,
  type PromptVariant,
  type MutationType,
  type OptimizerOptions,
} from "./optimizer.js";
