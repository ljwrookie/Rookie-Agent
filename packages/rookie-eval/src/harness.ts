// Eval Harness: Run benchmarks and generate reports (P2-T3)

import { readFile, mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import {
  BenchmarkCase,
  BenchmarkSuite,
  BenchmarkResult,
  BenchmarkRun,
  ComparisonResult,
} from "./types.js";

const execAsync = promisify(exec);

export interface EvalHarnessOptions {
  projectRoot: string;
  resultsDir?: string;
  defaultTimeout?: number;
}

export class EvalHarness {
  private options: Required<EvalHarnessOptions>;

  constructor(options: EvalHarnessOptions) {
    this.options = {
      projectRoot: options.projectRoot,
      resultsDir: options.resultsDir ?? ".rookie/eval-results",
      defaultTimeout: options.defaultTimeout ?? 60000,
    };
  }

  /**
   * Load a benchmark suite from JSONL file.
   */
  async loadSuite(filePath: string): Promise<BenchmarkSuite> {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    const cases: BenchmarkCase[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (this.isValidBenchmarkCase(parsed)) {
          cases.push(parsed);
        }
      } catch {
        // Skip invalid lines
      }
    }

    return {
      name: path.basename(filePath, ".jsonl"),
      description: `Loaded from ${filePath}`,
      cases,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Run a benchmark suite.
   */
  async runSuite(suite: BenchmarkSuite): Promise<BenchmarkRun> {
    const runId = `run_${Date.now()}`;
    const run: BenchmarkRun = {
      id: runId,
      suiteName: suite.name,
      startedAt: new Date().toISOString(),
      results: [],
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, totalDuration: 0 },
    };

    for (const testCase of suite.cases) {
      const result = await this.runCase(testCase);
      run.results.push(result);
      run.summary.total++;
      if (result.passed) {
        run.summary.passed++;
      } else if (result.error === "skipped") {
        run.summary.skipped++;
      } else if (result.error?.includes("timeout")) {
        run.summary.skipped++;
      } else {
        run.summary.failed++;
      }
      run.summary.totalDuration += result.duration;
    }

    run.completedAt = new Date().toISOString();
    await this.saveRun(run);

    return run;
  }

  /**
   * Run a single benchmark case.
   */
  private async runCase(testCase: BenchmarkCase): Promise<BenchmarkResult> {
    const startTime = Date.now();
    const timeout = testCase.timeout ?? this.options.defaultTimeout;

    try {
      // Execute the task using shell command if provided
      if (testCase.verifyCmd) {
        const { stdout, stderr } = await execAsync(testCase.verifyCmd, {
          cwd: this.options.projectRoot,
          timeout,
        });
        const output = stdout + (stderr ? `\n[stderr] ${stderr}` : "");
        const passed = this.checkExpected(output, testCase.expected);

        return {
          caseId: testCase.id,
          passed,
          output: output.slice(0, 10000), // Limit output size
          duration: Date.now() - startTime,
        };
      }

      // No verify command - mark as skipped
      return {
        caseId: testCase.id,
        passed: false,
        output: "No verify command provided",
        duration: Date.now() - startTime,
        error: "skipped",
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        caseId: testCase.id,
        passed: false,
        output: "",
        duration: Date.now() - startTime,
        error: error.includes("timeout") ? "timeout" : error,
      };
    }
  }

  /**
   * Compare two benchmark runs.
   */
  async compareRuns(baselineId: string, candidateId: string): Promise<ComparisonResult> {
    const baseline = await this.loadRun(baselineId);
    const candidate = await this.loadRun(candidateId);

    const improvements: ComparisonResult["improvements"] = [];
    const regressions: ComparisonResult["regressions"] = [];

    for (const baseResult of baseline.results) {
      const candResult = candidate.results.find((r) => r.caseId === baseResult.caseId);
      if (!candResult) continue;

      const delta = candResult.duration - baseResult.duration;

      if (!baseResult.passed && candResult.passed) {
        // Fixed
        improvements.push({
          caseId: baseResult.caseId,
          before: false,
          after: true,
          delta,
        });
      } else if (baseResult.passed && !candResult.passed) {
        // Regression
        regressions.push({
          caseId: baseResult.caseId,
          before: true,
          after: false,
          delta,
        });
      } else if (baseResult.passed && candResult.passed && delta < -100) {
        // Faster
        improvements.push({
          caseId: baseResult.caseId,
          before: true,
          after: true,
          delta,
        });
      } else if (baseResult.passed && candResult.passed && delta > 100) {
        // Slower
        regressions.push({
          caseId: baseResult.caseId,
          before: true,
          after: true,
          delta,
        });
      }
    }

    const baselinePassRate = baseline.summary.passed / baseline.summary.total;
    const candidatePassRate = candidate.summary.passed / candidate.summary.total;

    return {
      baseline: baselineId,
      candidate: candidateId,
      improvements,
      regressions,
      summary: {
        baselinePassRate,
        candidatePassRate,
        avgDurationDelta:
          candidate.summary.totalDuration - baseline.summary.totalDuration,
      },
    };
  }

  /**
   * Generate markdown report for a run.
   */
  async generateReport(run: BenchmarkRun): Promise<string> {
    const lines: string[] = [
      `# Benchmark Report: ${run.suiteName}`,
      "",
      `- **Run ID**: ${run.id}`,
      `- **Started**: ${run.startedAt}`,
      `- **Completed**: ${run.completedAt || "N/A"}`,
      "",
      "## Summary",
      "",
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Total | ${run.summary.total} |`,
      `| Passed | ${run.summary.passed} ✅ |`,
      `| Failed | ${run.summary.failed} ❌ |`,
      `| Skipped | ${run.summary.skipped} ⏭️ |`,
      `| Pass Rate | ${((run.summary.passed / run.summary.total) * 100).toFixed(1)}% |`,
      `| Total Duration | ${(run.summary.totalDuration / 1000).toFixed(1)}s |`,
      "",
      "## Results",
      "",
      `| Case | Status | Duration | Output |`,
      `|------|--------|----------|--------|`,
    ];

    for (const result of run.results) {
      const status = result.passed ? "✅ PASS" : result.error === "timeout" ? "⏭️ SKIP" : "❌ FAIL";
      const duration = `${(result.duration / 1000).toFixed(1)}s`;
      const output = result.error
        ? `Error: ${result.error.slice(0, 50)}`
        : result.output.slice(0, 50).replace(/\n/g, " ");
      lines.push(`| ${result.caseId} | ${status} | ${duration} | ${output}... |`);
    }

    lines.push("");

    return lines.join("\n");
  }

  /**
   * Save report to docs/eval/ directory.
   */
  async saveReport(run: BenchmarkRun): Promise<string> {
    const reportDir = path.join(this.options.projectRoot, "docs", "eval");
    await mkdir(reportDir, { recursive: true });

    const date = new Date().toISOString().split("T")[0];
    const filename = `${date}-${run.suiteName}.md`;
    const filepath = path.join(reportDir, filename);

    const report = await this.generateReport(run);
    await writeFile(filepath, report, "utf-8");

    return filepath;
  }

  // ─── Private helpers ───────────────────────────────────────

  private isValidBenchmarkCase(obj: unknown): obj is BenchmarkCase {
    if (!obj || typeof obj !== "object") return false;
    const c = obj as Record<string, unknown>;
    return (
      typeof c.id === "string" &&
      typeof c.task === "string" &&
      typeof c.expected === "string" &&
      Array.isArray(c.tags)
    );
  }

  private checkExpected(output: string, expected: string): boolean {
    // Simple substring match - could be enhanced with regex or fuzzy matching
    return output.toLowerCase().includes(expected.toLowerCase());
  }

  private async saveRun(run: BenchmarkRun): Promise<void> {
    const dir = path.join(this.options.projectRoot, this.options.resultsDir);
    await mkdir(dir, { recursive: true });

    const filepath = path.join(dir, `${run.id}.json`);
    await writeFile(filepath, JSON.stringify(run, null, 2), "utf-8");
  }

  private async loadRun(runId: string): Promise<BenchmarkRun> {
    const filepath = path.join(
      this.options.projectRoot,
      this.options.resultsDir,
      `${runId}.json`
    );
    const content = await readFile(filepath, "utf-8");
    return JSON.parse(content) as BenchmarkRun;
  }
}

export { BenchmarkCase, BenchmarkSuite, BenchmarkResult, BenchmarkRun, ComparisonResult };
