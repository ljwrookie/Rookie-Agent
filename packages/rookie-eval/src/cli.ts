#!/usr/bin/env node
// Eval Harness CLI (P2-T3)

import { Command } from "commander";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { EvalHarness } from "./harness.js";
import { SelfOptimizer } from "./optimizer.js";
import type { BenchmarkSuite } from "./types.js";

const program = new Command();

program
  .name("rookie-eval")
  .description("Evaluation harness for Rookie Agent")
  .version("0.1.0");

// ── run <suite> ─────────────────────────────────────────
program
  .command("run")
  .description("Run a benchmark suite")
  .argument("<suite>", "Path to benchmark JSONL file")
  .option("--cwd <path>", "Project root", process.cwd())
  .option("--timeout <ms>", "Default timeout per case", "60000")
  .action(async (suitePath: string, opts: { cwd: string; timeout: string }) => {
    const harness = new EvalHarness({
      projectRoot: opts.cwd,
      defaultTimeout: parseInt(opts.timeout, 10),
    });

    console.log(`Loading suite: ${suitePath}`);
    const suite = await harness.loadSuite(suitePath);
    console.log(`Loaded ${suite.cases.length} cases\n`);

    const run = await harness.runSuite(suite);

    console.log(`\nRun complete: ${run.id}`);
    console.log(`Total: ${run.summary.total}`);
    console.log(`Passed: ${run.summary.passed} ✅`);
    console.log(`Failed: ${run.summary.failed} ❌`);
    console.log(`Skipped: ${run.summary.skipped} ⏭️`);
    console.log(`Duration: ${(run.summary.totalDuration / 1000).toFixed(1)}s`);

    const reportPath = await harness.saveReport(run);
    console.log(`\nReport saved: ${reportPath}`);

    process.exit(run.summary.failed > 0 ? 1 : 0);
  });

// ── diff <a> <b> ────────────────────────────────────────
program
  .command("diff")
  .description("Compare two benchmark runs")
  .argument("<baseline>", "Baseline run ID")
  .argument("<candidate>", "Candidate run ID")
  .option("--cwd <path>", "Project root", process.cwd())
  .action(async (
    baselineId: string,
    candidateId: string,
    opts: { cwd: string }
  ) => {
    const harness = new EvalHarness({ projectRoot: opts.cwd });

    const comparison = await harness.compareRuns(baselineId, candidateId);

    console.log(`\nComparison: ${comparison.baseline} vs ${comparison.candidate}`);
    console.log(`\nImprovements: ${comparison.improvements.length}`);
    for (const imp of comparison.improvements) {
      const status = imp.before ? "faster" : "fixed";
      console.log(`  ✅ ${imp.caseId} (${status})`);
    }

    console.log(`\nRegressions: ${comparison.regressions.length}`);
    for (const reg of comparison.regressions) {
      const status = reg.before ? "slower" : "broken";
      console.log(`  ❌ ${reg.caseId} (${status})`);
    }

    console.log(`\nBaseline pass rate: ${(comparison.summary.baselinePassRate * 100).toFixed(1)}%`);
    console.log(`Candidate pass rate: ${(comparison.summary.candidatePassRate * 100).toFixed(1)}%`);
    console.log(`Avg duration delta: ${comparison.summary.avgDurationDelta}ms`);
  });

// ── init-suite <name> ───────────────────────────────────
program
  .command("init-suite")
  .description("Create a new benchmark suite with a sample case")
  .argument("<name>", "Suite name")
  .option("--cwd <path>", "Project root", process.cwd())
  .action(async (name: string, opts: { cwd: string }) => {
    const suiteDir = path.join(opts.cwd, ".rookie", "benchmarks");
    await mkdir(suiteDir, { recursive: true });

    const suitePath = path.join(suiteDir, `${name}.jsonl`);

    const sampleCase = {
      id: "readme-title",
      task: "Update README title",
      expected: "Rookie Agent",
      verifyCmd: "head -1 README.md",
      tags: ["basic", "documentation"],
      timeout: 10000,
    };

    await writeFile(suitePath, JSON.stringify(sampleCase) + "\n", "utf-8");
    console.log(`Created benchmark suite: ${suitePath}`);
    console.log(`Edit the file to add more cases.`);
  });

// ── optimize <skill> <suite> ────────────────────────────
program
  .command("optimize")
  .description("Run self-optimization for a skill")
  .argument("<skill>", "Skill name")
  .argument("<suite>", "Path to benchmark suite")
  .option("--cwd <path>", "Project root", process.cwd())
  .option("--max-variants <n>", "Max prompt variants", "3")
  .action(async (
    skillName: string,
    suitePath: string,
    opts: { cwd: string; maxVariants: string }
  ) => {
    const harness = new EvalHarness({ projectRoot: opts.cwd });
    const optimizer = new SelfOptimizer({
      projectRoot: opts.cwd,
      maxVariants: parseInt(opts.maxVariants, 10),
    });

    const suite = await harness.loadSuite(suitePath);

    // Load current skill prompt (simplified: read SKILL.md)
    const skillPath = path.join(opts.cwd, ".rookie", "skills", skillName, "SKILL.md");
    let currentPrompt = "Default skill prompt";
    try {
      currentPrompt = await readFile(skillPath, "utf-8");
    } catch {
      console.log(`Warning: Could not read ${skillPath}, using default prompt`);
    }

    console.log(`Optimizing skill: ${skillName}`);
    console.log(`Benchmark: ${suite.cases.length} cases\n`);

    const run = await optimizer.optimizeSkill(skillName, currentPrompt, suite);

    console.log(`\nOptimization complete: ${run.id}`);
    console.log(`Winner: ${run.winnerId}`);
    console.log(`Improvement: ${run.improvement.toFixed(1)}%`);

    const reportPath = await optimizer.saveReport(run);
    console.log(`\nReport saved: ${reportPath}`);
  });

program.parse();
