import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { SelfOptimizer, PromptMutator } from "../src/optimizer.js";
import { BenchmarkSuite } from "../src/types.js";

describe("PromptMutator", () => {
  describe("generateVariants", () => {
    it("generates multiple variants", () => {
      const mutator = new PromptMutator();
      const basePrompt = "Help me write code that is efficient and clean.";
      const variants = mutator.generateVariants(basePrompt, 3);

      expect(variants).toHaveLength(3);
      expect(variants[0].mutationType).toBe("paraphrase");
      expect(variants[1].mutationType).toBe("reorder");
      expect(variants[2].mutationType).toBe("condense");
    });

    it("each variant has unique id", () => {
      const mutator = new PromptMutator();
      const basePrompt = "Test prompt";
      const variants = mutator.generateVariants(basePrompt, 3);

      const ids = new Set(variants.map((v) => v.id));
      expect(ids.size).toBe(3);
    });
  });

  describe("paraphrase mutation", () => {
    it("replaces common words with synonyms", () => {
      const mutator = new PromptMutator();
      const basePrompt = "Help me use this tool to make something.";
      const variants = mutator.generateVariants(basePrompt, 1);

      expect(variants[0].prompt).toContain("utilize");
      expect(variants[0].prompt).toContain("create");
      expect(variants[0].prompt).toContain("assist");
    });
  });

  describe("condense mutation", () => {
    it("removes redundant phrases", () => {
      const mutator = new PromptMutator();
      const basePrompt = "In order to make it work, due to the fact that it is broken.";
      const variants = mutator.generateVariants(basePrompt, 3);

      const condensed = variants.find((v) => v.mutationType === "condense");
      expect(condensed).toBeDefined();
      expect(condensed!.prompt).not.toContain("in order to");
      expect(condensed!.prompt).not.toContain("due to the fact that");
    });
  });
});

describe("SelfOptimizer", () => {
  let dir: string;
  let optimizer: SelfOptimizer;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-optimizer-"));
    optimizer = new SelfOptimizer({
      projectRoot: dir,
      maxVariants: 2,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("optimizeSkill", () => {
    it("runs optimization and returns results", async () => {
      const suite: BenchmarkSuite = {
        name: "test-suite",
        description: "Test suite",
        cases: [
          {
            id: "test-1",
            task: "Echo hello",
            expected: "hello",
            verifyCmd: "echo hello",
            tags: ["basic"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = await optimizer.optimizeSkill("test-skill", "Original prompt", suite);

      expect(run.skillName).toBe("test-skill");
      expect(run.variants).toHaveLength(3); // baseline + 2 mutations
      expect(run.results.size).toBe(3);
      expect(run.winnerId).toBeDefined();
      expect(run.improvement).toBeDefined();
    });

    it("saves optimization run to disk", async () => {
      const suite: BenchmarkSuite = {
        name: "test-suite",
        description: "Test suite",
        cases: [
          {
            id: "test-1",
            task: "Echo hello",
            expected: "hello",
            verifyCmd: "echo hello",
            tags: ["basic"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = await optimizer.optimizeSkill("test-skill", "Original prompt", suite);

      const historyDir = path.join(dir, ".rookie", "optimization-history", "test-skill");
      const files = await readdir(historyDir);
      expect(files).toContain(`${run.id}.json`);
    });
  });

  describe("generateReport", () => {
    it("generates markdown report", async () => {
      const suite: BenchmarkSuite = {
        name: "test-suite",
        description: "Test suite",
        cases: [
          {
            id: "test-1",
            task: "Echo hello",
            expected: "hello",
            verifyCmd: "echo hello",
            tags: ["basic"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = await optimizer.optimizeSkill("test-skill", "Original prompt", suite);
      const report = await optimizer.generateReport(run);

      expect(report).toContain("# Optimization Report: test-skill");
      expect(report).toContain("## Variants Tested");
      expect(report).toContain("baseline");
      expect(report).toContain("## Improvement Analysis");
    });
  });

  describe("saveReport", () => {
    it("saves report to docs/eval/", async () => {
      const suite: BenchmarkSuite = {
        name: "test-suite",
        description: "Test suite",
        cases: [
          {
            id: "test-1",
            task: "Echo hello",
            expected: "hello",
            verifyCmd: "echo hello",
            tags: ["basic"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = await optimizer.optimizeSkill("test-skill", "Original prompt", suite);
      const filepath = await optimizer.saveReport(run);

      expect(filepath).toContain("docs/eval/");
      expect(filepath).toContain("evolution-test-skill.md");

      const content = await readFile(filepath, "utf-8");
      expect(content).toContain("# Optimization Report: test-skill");
    });
  });

  describe("rollback", () => {
    it("records rollback to history", async () => {
      const suite: BenchmarkSuite = {
        name: "test-suite",
        description: "Test suite",
        cases: [
          {
            id: "test-1",
            task: "Echo hello",
            expected: "hello",
            verifyCmd: "echo hello",
            tags: ["basic"],
          },
        ],
        createdAt: new Date().toISOString(),
      };

      const run = await optimizer.optimizeSkill("test-skill", "Original prompt", suite);
      const success = await optimizer.rollback("test-skill", run.id);

      expect(success).toBe(true);

      const rollbackDir = path.join(dir, ".rookie", "optimization-history", "rollbacks");
      const files = await readdir(rollbackDir);
      expect(files.length).toBeGreaterThan(0);
    });
  });
});
