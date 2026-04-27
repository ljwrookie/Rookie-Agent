// Eval Harness types (P2-T3)

export interface BenchmarkCase {
  id: string;
  task: string;
  expected: string;
  verifyCmd?: string;
  tags: string[];
  timeout?: number;
}

export interface BenchmarkSuite {
  name: string;
  description: string;
  cases: BenchmarkCase[];
  createdAt: string;
}

export interface BenchmarkResult {
  caseId: string;
  passed: boolean;
  output: string;
  duration: number;
  error?: string;
}

export interface BenchmarkRun {
  id: string;
  suiteName: string;
  startedAt: string;
  completedAt?: string;
  results: BenchmarkResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    totalDuration: number;
  };
}

export interface ComparisonResult {
  baseline: string;
  candidate: string;
  improvements: Array<{
    caseId: string;
    before: boolean;
    after: boolean;
    delta: number; // duration difference
  }>;
  regressions: Array<{
    caseId: string;
    before: boolean;
    after: boolean;
    delta: number;
  }>;
  summary: {
    baselinePassRate: number;
    candidatePassRate: number;
    avgDurationDelta: number;
  };
}
