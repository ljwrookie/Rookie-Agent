import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { EvalHarness } from "../src/harness.js";
import type { BenchmarkSuite, BenchmarkCase } from "../src/types.js";

describe("EvalHarness", () => {
  let dir: string;
  let harness: EvalHarness;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-eval-"));
    harness = new EvalHarness({ projectRoot: dir });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("loadSuite", () => {
    it("loads benchmark suite from JSONL file", async () => {
      const jsonl = [
        JSON.stringify({ id: "test-1", task: "Test 1", expected: "pass", tags: ["basic"] }),
        JSON.stringify({ id: "test-2", task: "Test 2", expected: "success", tags: ["basic"] }),
      ].join("\n");

      const suitePath = path.join(dir, "test-suite.jsonl");
      await writeFile(suitePath, jsonl, "utf-8");

      const suite = await harness.loadSuite(suitePath);
      expect(suite.name).toBe("test-suite");
      expect(suite.cases).toHaveLength(2);
      expect(suite.cases[0].id).toBe("test-1");
    });

    it("skips invalid JSON lines", async () => {
      const jsonl = [
        JSON.stringify({ id: "valid", task: "Valid", expected: "ok", tags: [] }),
        "invalid json",
        JSON.stringify({ id: "valid2", task: "Valid2", expected: "ok", tags: [] }),
      ].join("\n");

      const suitePath = path.join(dir, "test-suite.jsonl");
      await writeFile(suitePath, jsonl, "utf-8");

      const suite = await harness.loadSuite(suitePath);
      expect(suite.cases).toHaveLength(2);
    });
  });

  describe("runSuite", () => {
    it("runs benchmark suite and returns results", async () => {
      const suite: BenchmarkSuite = {
        name: "test-suite",
        description: "Test suite",
        cases: [
          {
            id: "echo-test",
            task: "Echo test",
            expected: "hello",
            verifyCmd: "echo hello",
            tags: ["basic"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = await harness.runSuite(suite);
      expect(run.suiteName).toBe("test-suite");
      expect(run.results).toHaveLength(1);
      expect(run.results[0].passed).toBe(true);
      expect(run.summary.passed).toBe(1);
    });

    it("handles failing tests", async () => {
      const suite: BenchmarkSuite = {
        name: "fail-suite",
        description: "Failing suite",
        cases: [
          {
            id: "fail-test",
            task: "Fail test",
            expected: "not-found",
            verifyCmd: "echo hello",
            tags: ["basic"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = await harness.runSuite(suite);
      expect(run.results[0].passed).toBe(false);
      expect(run.summary.failed).toBe(1);
    });

    it("handles missing verify command", async () => {
      const suite: BenchmarkSuite = {
        name: "skip-suite",
        description: "Skipped suite",
        cases: [
          {
            id: "skip-test",
            task: "Skip test",
            expected: "ok",
            tags: ["basic"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = await harness.runSuite(suite);
      expect(run.results[0].error).toBe("skipped");
      expect(run.summary.skipped).toBe(1);
    });
  });

  describe("compareRuns", () => {
    it("compares two benchmark runs", async () => {
      // Create two runs manually
      const run1 = {
        id: "run-1",
        suiteName: "suite",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        results: [
          { caseId: "test-1", passed: false, output: "", duration: 1000 },
          { caseId: "test-2", passed: true, output: "", duration: 500 },
        ],
        summary: { total: 2, passed: 1, failed: 1, skipped: 0, totalDuration: 1500 },
      };

      const run2 = {
        id: "run-2",
        suiteName: "suite",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        results: [
          { caseId: "test-1", passed: true, output: "", duration: 800 },
          { caseId: "test-2", passed: true, output: "", duration: 400 },
        ],
        summary: { total: 2, passed: 2, failed: 0, skipped: 0, totalDuration: 1200 },
      };

      // Save runs
      const resultsDir = path.join(dir, ".rookie", "eval-results");
      await mkdir(resultsDir, { recursive: true });
      await writeFile(path.join(resultsDir, "run-1.json"), JSON.stringify(run1), "utf-8");
      await writeFile(path.join(resultsDir, "run-2.json"), JSON.stringify(run2), "utf-8");

      const comparison = await harness.compareRuns("run-1", "run-2");
      expect(comparison.baseline).toBe("run-1");
      expect(comparison.candidate).toBe("run-2");
      expect(comparison.improvements).toHaveLength(1);
      expect(comparison.improvements[0].caseId).toBe("test-1");
      expect(comparison.summary.candidatePassRate).toBe(1);
    });
  });

  describe("generateReport", () => {
    it("generates markdown report", async () => {
      const run = {
        id: "run-report",
        suiteName: "report-suite",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        results: [
          { caseId: "test-1", passed: true, output: "ok", duration: 1000 },
          { caseId: "test-2", passed: false, output: "error", duration: 500, error: "failed" },
        ],
        summary: { total: 2, passed: 1, failed: 1, skipped: 0, totalDuration: 1500 },
      };

      const report = await harness.generateReport(run);
      expect(report).toContain("# Benchmark Report: report-suite");
      expect(report).toContain("| Passed | 1 ✅ |");
      expect(report).toContain("| Failed | 1 ❌ |");
      expect(report).toContain("test-1");
      expect(report).toContain("test-2");
    });

    it("saves report to docs/eval/", async () => {
      const run = {
        id: "run-save",
        suiteName: "save-suite",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        results: [{ caseId: "test-1", passed: true, output: "ok", duration: 1000 }],
        summary: { total: 1, passed: 1, failed: 0, skipped: 0, totalDuration: 1000 },
      };

      const filepath = await harness.saveReport(run);
      expect(filepath).toContain("docs/eval/");
      expect(filepath).toContain("save-suite.md");

      const content = await readFile(filepath, "utf-8");
      expect(content).toContain("# Benchmark Report: save-suite");
    });
  });
});
