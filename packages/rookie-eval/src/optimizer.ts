// Self-optimization Pipeline: Prompt mutation and selection (P2-T5)

import { readFile, writeFile, mkdir, readdir, copyFile } from "node:fs/promises";
import * as path from "node:path";
import { EvalHarness } from "./harness.js";
import { BenchmarkSuite, BenchmarkRun } from "./types.js";

// ─── Types ───────────────────────────────────────────────────────

export interface PromptVariant {
  id: string;
  name: string;
  prompt: string;
  parentId?: string;
  mutationType: MutationType;
  createdAt: string;
}

export type MutationType =
  | "original"
  | "paraphrase"      // Reword without changing meaning
  | "reorder"         // Reorder sections
  | "condense"        // Remove redundant words
  | "expand"          // Add clarifying details
  | "example_add"     // Add examples
  | "example_remove"; // Remove examples

export interface OptimizationRun {
  id: string;
  skillName: string;
  baselineId: string;
  variants: PromptVariant[];
  results: Map<string, BenchmarkRun>;
  winnerId: string | null;
  improvement: number;  // Percentage improvement over baseline
  createdAt: string;
  completedAt?: string;
}

export interface OptimizerOptions {
  projectRoot: string;
  variantsDir?: string;
  historyDir?: string;
  maxVariants?: number;
  mutationRate?: number;
}

// ─── Prompt Mutator ──────────────────────────────────────────────

export class PromptMutator {
  /**
   * Generate variants of a prompt using different mutation strategies.
   */
  generateVariants(basePrompt: string, count: number = 3): PromptVariant[] {
    const variants: PromptVariant[] = [];
    const mutations: MutationType[] = ["paraphrase", "reorder", "condense"];

    for (let i = 0; i < Math.min(count, mutations.length); i++) {
      const mutationType = mutations[i];
      const mutated = this.applyMutation(basePrompt, mutationType);
      variants.push({
        id: `variant_${Date.now()}_${i}`,
        name: `${mutationType}_${i + 1}`,
        prompt: mutated,
        mutationType,
        createdAt: new Date().toISOString(),
      });
    }

    return variants;
  }

  private applyMutation(prompt: string, type: MutationType): string {
    switch (type) {
      case "paraphrase":
        return this.paraphrase(prompt);
      case "reorder":
        return this.reorder(prompt);
      case "condense":
        return this.condense(prompt);
      case "expand":
        return this.expand(prompt);
      default:
        return prompt;
    }
  }

  private paraphrase(prompt: string): string {
    // Simple synonym replacements
    return prompt
      .replace(/\buse\b/gi, "utilize")
      .replace(/\bmake\b/gi, "create")
      .replace(/\bhelp\b/gi, "assist")
      .replace(/\bshow\b/gi, "demonstrate")
      .replace(/\btell\b/gi, "explain");
  }

  private reorder(prompt: string): string {
    const sections = prompt.split(/\n\n+/);
    if (sections.length < 2) return prompt;

    // Move last section to front as a simple reorder
    const last = sections.pop()!;
    return [last, ...sections].join("\n\n");
  }

  private condense(prompt: string): string {
    return prompt
      .replace(/\s+/g, " ")
      .replace(/\.,/g, ".")
      .replace(/\bin order to\b/gi, "to")
      .replace(/\bdue to the fact that\b/gi, "because")
      .replace(/\bat this point in time\b/gi, "now")
      .trim();
  }

  private expand(prompt: string): string {
    return `${prompt}\n\nPlease ensure your response is thorough and considers edge cases.`;
  }
}

// ─── Self Optimizer ──────────────────────────────────────────────

export class SelfOptimizer {
  private options: Required<OptimizerOptions>;
  private harness: EvalHarness;
  private mutator: PromptMutator;

  constructor(options: OptimizerOptions) {
    this.options = {
      projectRoot: options.projectRoot,
      variantsDir: options.variantsDir ?? ".rookie/prompt-variants",
      historyDir: options.historyDir ?? ".rookie/optimization-history",
      maxVariants: options.maxVariants ?? 3,
      mutationRate: options.mutationRate ?? 0.3,
    };
    this.harness = new EvalHarness({ projectRoot: this.options.projectRoot });
    this.mutator = new PromptMutator();
  }

  /**
   * Run optimization for a skill against a benchmark suite.
   */
  async optimizeSkill(
    skillName: string,
    currentPrompt: string,
    suite: BenchmarkSuite
  ): Promise<OptimizationRun> {
    const runId = `opt_${Date.now()}`;
    const run: OptimizationRun = {
      id: runId,
      skillName,
      baselineId: "baseline",
      variants: [],
      results: new Map(),
      winnerId: null,
      improvement: 0,
      createdAt: new Date().toISOString(),
    };

    // Create baseline variant
    const baseline: PromptVariant = {
      id: "baseline",
      name: "baseline",
      prompt: currentPrompt,
      mutationType: "original",
      createdAt: new Date().toISOString(),
    };
    run.variants.push(baseline);

    // Generate mutations
    const mutations = this.mutator.generateVariants(
      currentPrompt,
      this.options.maxVariants
    );
    run.variants.push(...mutations);

    // Run benchmark for each variant
    for (const variant of run.variants) {
      // In a real implementation, this would swap the prompt in the skill
      // and run the benchmark. For now, we simulate with the same suite.
      const result = await this.harness.runSuite(suite);
      run.results.set(variant.id, result);
    }

    // Determine winner
    const winner = this.selectWinner(run);
    run.winnerId = winner.id;

    // Calculate improvement
    const baselineResult = run.results.get("baseline")!;
    const winnerResult = run.results.get(winner.id)!;
    run.improvement = this.calculateImprovement(baselineResult, winnerResult);

    run.completedAt = new Date().toISOString();

    // Save run
    await this.saveOptimizationRun(run);

    return run;
  }

  /**
   * Compare two optimization runs.
   */
  async compareRuns(runId1: string, runId2: string): Promise<{
    run1: OptimizationRun;
    run2: OptimizationRun;
    betterRun: OptimizationRun;
    reason: string;
  }> {
    const run1 = await this.loadOptimizationRun(runId1);
    const run2 = await this.loadOptimizationRun(runId2);

    const score1 = this.scoreRun(run1);
    const score2 = this.scoreRun(run2);

    if (score1 > score2) {
      return { run1, run2, betterRun: run1, reason: "Higher pass rate" };
    } else if (score2 > score1) {
      return { run1, run2, betterRun: run2, reason: "Higher pass rate" };
    }

    // Tie-breaker: lower duration
    const dur1 = Array.from(run1.results.values())[0]?.summary.totalDuration ?? 0;
    const dur2 = Array.from(run2.results.values())[0]?.summary.totalDuration ?? 0;

    if (dur1 <= dur2) {
      return { run1, run2, betterRun: run1, reason: "Faster execution" };
    }
    return { run1, run2, betterRun: run2, reason: "Faster execution" };
  }

  /**
   * Generate optimization report.
   */
  async generateReport(run: OptimizationRun): Promise<string> {
    const lines: string[] = [
      `# Optimization Report: ${run.skillName}`,
      "",
      `- **Run ID**: ${run.id}`,
      `- **Created**: ${run.createdAt}`,
      `- **Completed**: ${run.completedAt || "N/A"}`,
      `- **Winner**: ${run.winnerId}`,
      `- **Improvement**: ${run.improvement.toFixed(1)}%`,
      "",
      "## Variants Tested",
      "",
      "| Variant | Type | Pass Rate | Duration |",
      "|---------|------|-----------|----------|",
    ];

    for (const variant of run.variants) {
      const result = run.results.get(variant.id);
      if (!result) continue;

      const passRate = ((result.summary.passed / result.summary.total) * 100).toFixed(1);
      const duration = `${(result.summary.totalDuration / 1000).toFixed(1)}s`;
      const marker = variant.id === run.winnerId ? " 🏆" : "";

      lines.push(
        `| ${variant.name}${marker} | ${variant.mutationType} | ${passRate}% | ${duration} |`
      );
    }

    lines.push("");

    // Winner details
    if (run.winnerId) {
      const winner = run.variants.find((v) => v.id === run.winnerId);
      if (winner) {
        lines.push("## Winning Prompt", "");
        lines.push("```");
        lines.push(winner.prompt.slice(0, 500) + (winner.prompt.length > 500 ? "..." : ""));
        lines.push("```");
        lines.push("");
      }
    }

    // Improvement analysis
    lines.push("## Improvement Analysis", "");
    if (run.improvement > 0) {
      lines.push(`The winning variant improved performance by **${run.improvement.toFixed(1)}%**.`);
    } else if (run.improvement < 0) {
      lines.push(`No improvement was found. The best variant performed **${Math.abs(run.improvement).toFixed(1)}%** worse than baseline.`);
    } else {
      lines.push("No significant difference was found between variants.");
    }
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Save report to docs/eval/ directory.
   */
  async saveReport(run: OptimizationRun): Promise<string> {
    const reportDir = path.join(this.options.projectRoot, "docs", "eval");
    await mkdir(reportDir, { recursive: true });

    const date = new Date().toISOString().split("T")[0];
    const filename = `${date}-evolution-${run.skillName}.md`;
    const filepath = path.join(reportDir, filename);

    const report = await this.generateReport(run);
    await writeFile(filepath, report, "utf-8");

    return filepath;
  }

  /**
   * Rollback to a previous prompt version.
   */
  async rollback(skillName: string, runId: string): Promise<boolean> {
    const run = await this.loadOptimizationRun(runId);
    const baseline = run.variants.find((v) => v.id === "baseline");

    if (!baseline) return false;

    // In a real implementation, this would restore the prompt to the skill file
    // For now, we just log the rollback
    const rollbackDir = path.join(this.options.projectRoot, this.options.historyDir, "rollbacks");
    await mkdir(rollbackDir, { recursive: true });

    const rollbackRecord = {
      skillName,
      runId,
      timestamp: new Date().toISOString(),
      restoredPrompt: baseline.prompt.slice(0, 200) + "...",
    };

    await writeFile(
      path.join(rollbackDir, `${skillName}_${Date.now()}.json`),
      JSON.stringify(rollbackRecord, null, 2),
      "utf-8"
    );

    return true;
  }

  // ─── Private helpers ────────────────────────────────────────

  private selectWinner(run: OptimizationRun): PromptVariant {
    let bestVariant = run.variants[0];
    let bestScore = -1;

    for (const variant of run.variants) {
      const result = run.results.get(variant.id);
      if (!result) continue;

      const score = this.scoreRunResult(result);
      if (score > bestScore) {
        bestScore = score;
        bestVariant = variant;
      }
    }

    return bestVariant;
  }

  private scoreRunResult(result: BenchmarkRun): number {
    const passRate = result.summary.passed / result.summary.total;
    // Penalize long durations slightly
    const durationPenalty = Math.min(result.summary.totalDuration / 60000, 0.1);
    return passRate - durationPenalty;
  }

  private scoreRun(run: OptimizationRun): number {
    const baselineResult = run.results.get("baseline");
    if (!baselineResult) return 0;
    return this.scoreRunResult(baselineResult);
  }

  private calculateImprovement(baseline: BenchmarkRun, candidate: BenchmarkRun): number {
    const baselineScore = baseline.summary.passed / baseline.summary.total;
    const candidateScore = candidate.summary.passed / candidate.summary.total;

    if (baselineScore === 0) return candidateScore > 0 ? 100 : 0;
    return ((candidateScore - baselineScore) / baselineScore) * 100;
  }

  private async saveOptimizationRun(run: OptimizationRun): Promise<void> {
    const dir = path.join(this.options.projectRoot, this.options.historyDir, run.skillName);
    await mkdir(dir, { recursive: true });

    // Convert Map to object for serialization
    const serialized = {
      ...run,
      results: Object.fromEntries(run.results),
    };

    await writeFile(
      path.join(dir, `${run.id}.json`),
      JSON.stringify(serialized, null, 2),
      "utf-8"
    );
  }

  private async loadOptimizationRun(runId: string): Promise<OptimizationRun> {
    // Find the run file
    const historyDir = path.join(this.options.projectRoot, this.options.historyDir);
    const dirs: string[] = await readdir(historyDir).catch(() => []);

    for (const dir of dirs) {
      const files: string[] = await readdir(path.join(historyDir, dir)).catch(() => []);
      if (files.includes(`${runId}.json`)) {
        const content = await readFile(
          path.join(historyDir, dir, `${runId}.json`),
          "utf-8"
        );
        const parsed = JSON.parse(content);
        return {
          ...parsed,
          results: new Map(Object.entries(parsed.results)),
        };
      }
    }

    throw new Error(`Optimization run ${runId} not found`);
  }
}
