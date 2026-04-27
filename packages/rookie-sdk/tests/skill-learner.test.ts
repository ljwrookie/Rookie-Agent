import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { SkillLearner } from "../src/skills/learner.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { CompletedTask, SkillUsage } from "../src/skills/types.js";

describe("SkillLearner", () => {
  let dir: string;
  let registry: SkillRegistry;
  let learner: SkillLearner;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-skill-"));
    registry = new SkillRegistry();
    learner = new SkillLearner(registry, path.join(dir, "skills"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("evaluateForCreation", () => {
    it("returns null for failed tasks", async () => {
      const task: CompletedTask = {
        id: "t1",
        description: "Fix bug",
        messages: [{ role: "user", content: "fix it" }],
        tools_used: ["file_read", "file_write"],
        success: false,
      };
      const result = await learner.evaluateForCreation(task);
      expect(result).toBeNull();
    });

    it("returns null for tasks with fewer than 2 tools", async () => {
      const task: CompletedTask = {
        id: "t2",
        description: "Read file",
        messages: [{ role: "user", content: "read it" }],
        tools_used: ["file_read"],
        success: true,
      };
      const result = await learner.evaluateForCreation(task);
      expect(result).toBeNull();
    });

    it("returns null for tasks with fewer than 3 messages", async () => {
      const task: CompletedTask = {
        id: "t3",
        description: "Fix bug",
        messages: [{ role: "user", content: "fix" }],
        tools_used: ["file_read", "file_write"],
        success: true,
      };
      const result = await learner.evaluateForCreation(task);
      expect(result).toBeNull();
    });

    it("generates candidate for valid tasks", async () => {
      const task: CompletedTask = {
        id: "t4",
        description: "Fix login bug by updating auth logic",
        messages: [
          { role: "user", content: "fix login bug" },
          { role: "assistant", content: "I'll help you fix the login bug by examining the auth logic." },
          { role: "assistant", content: "Let me read the auth file." },
          { role: "assistant", content: "Now I'll update the logic." },
          { role: "assistant", content: "Done! The login bug is fixed." },
        ],
        tools_used: ["file_read", "file_write", "shell_execute"],
        success: true,
      };
      const result = await learner.evaluateForCreation(task);
      expect(result).not.toBeNull();
      expect(result!.name).toBe("fix-login-bug-by-updating-auth-logic");
      expect(result!.description).toBe(task.description);
      expect(result!.tools).toContain("file_read");
      expect(result!.tools).toContain("file_write");
    });

    it("returns null for similar existing skills", async () => {
      // Register an existing skill with very similar description
      registry.register({
        name: "fix-login",
        version: "1.0.0",
        description: "Fix login bug",
        triggers: [{ type: "command", value: "/fix-login" }],
        tools: ["file_read", "file_write"],
        prompt: "Fix login bugs",
        examples: [],
      });

      const task: CompletedTask = {
        id: "t5",
        description: "Fix login bug", // Same description = high similarity
        messages: [
          { role: "user", content: "fix login" },
          { role: "assistant", content: "I'll help fix the login issue." },
          { role: "assistant", content: "Let me check the auth." },
          { role: "assistant", content: "Fixed!" },
        ],
        tools_used: ["file_read", "file_write", "shell_execute"],
        success: true,
      };
      const result = await learner.evaluateForCreation(task);
      expect(result).toBeNull();
    });
  });

  describe("createSkill", () => {
    it("writes SKILL.md file and registers skill", async () => {
      const candidate = {
        name: "test-skill",
        description: "A test skill",
        prompt: "Test prompt content",
        tools: ["file_read", "file_write"],
        source: { taskId: "t1", steps: [] },
      };

      const skill = await learner.createSkill(candidate);

      expect(skill.name).toBe("test-skill");
      expect(registry.get("test-skill")).toBeDefined();

      const skillPath = path.join(dir, "skills", "test-skill", "SKILL.md");
      await access(skillPath);

      const content = await readFile(skillPath, "utf-8");
      expect(content).toContain("name: test-skill");
      expect(content).toContain("description: A test skill");
      expect(content).toContain("allowed-tools: file_read file_write");
      expect(content).toContain("Test prompt content");
    });
  });

  describe("usage tracking", () => {
    it("records and retrieves usage stats", () => {
      const usages: SkillUsage[] = [
        { skillName: "skill-a", timestamp: Date.now(), success: true, duration: 1000 },
        { skillName: "skill-a", timestamp: Date.now(), success: true, duration: 2000 },
        { skillName: "skill-a", timestamp: Date.now(), success: false, duration: 500 },
        { skillName: "skill-b", timestamp: Date.now(), success: true, duration: 3000 },
      ];

      for (const u of usages) learner.recordUsage(u);

      const stats = learner.getUsageStats();
      expect(stats.get("skill-a")!.count).toBe(3);
      expect(stats.get("skill-a")!.successRate).toBe(2 / 3);
      expect(stats.get("skill-a")!.avgDuration).toBe(3500 / 3);
      expect(stats.get("skill-b")!.count).toBe(1);
    });
  });

  describe("performance evaluation", () => {
    it("suggests prompt update for low success rate", async () => {
      const skill = {
        name: "low-success-skill",
        version: "1.0.0",
        description: "A skill with low success",
        triggers: [{ type: "command", value: "/low" }],
        tools: ["file_read"],
        prompt: "Original prompt",
        examples: [],
      };

      // Record 5 failures out of 6
      for (let i = 0; i < 6; i++) {
        learner.recordUsage({
          skillName: skill.name,
          timestamp: Date.now(),
          success: i === 0,
          duration: 1000,
          userEdits: i > 0 ? ["had to fix this"] : undefined,
        });
      }

      const improvement = await learner.evaluatePerformance(skill);
      expect(improvement).not.toBeNull();
      expect(improvement!.type).toBe("prompt_update");
    });

    it("suggests tool update when tools are missing", async () => {
      const skill = {
        name: "missing-tool-skill",
        version: "1.0.0",
        description: "Needs more tools",
        triggers: [{ type: "command", value: "/missing" }],
        tools: ["file_read"],
        prompt: "Prompt",
        examples: [],
      };

      // Record usages where users mention needing file_write
      for (let i = 0; i < 5; i++) {
        learner.recordUsage({
          skillName: skill.name,
          timestamp: Date.now(),
          success: true,
          duration: 1000,
          userEdits: ["need to use file_write"],
        });
      }

      const improvement = await learner.evaluatePerformance(skill);
      expect(improvement).not.toBeNull();
      expect(improvement!.type).toBe("tool_update");
      expect(improvement!.after).toContain("file_write");
    });
  });

  describe("rewrite pool (P2-T2)", () => {
    it("adds low-performing skills to rewrite pool", async () => {
      const skill = {
        name: "low-performer",
        version: "1.0.0",
        description: "A skill with issues",
        triggers: [{ type: "command", value: "/low" }],
        tools: ["file_read"],
        prompt: "Problematic prompt",
        examples: [],
      };
      registry.register(skill);

      // Record failures
      for (let i = 0; i < 5; i++) {
        learner.recordUsage({
          skillName: skill.name,
          timestamp: Date.now(),
          success: false,
          duration: 1000,
        });
      }

      const candidates = await learner.scanForRewriteCandidates();
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0].skill.name).toBe("low-performer");
      expect(candidates[0].status).toBe("pending");
    });

    it("approves and applies rewrite candidate", async () => {
      const skill = {
        name: "rewrite-test",
        version: "1.0.0",
        description: "Test skill",
        triggers: [{ type: "command", value: "/test" }],
        tools: ["file_read"],
        prompt: "Old prompt",
        examples: [],
      };
      registry.register(skill);

      // Add to pool manually
      learner.addToRewritePool(skill, {
        type: "prompt_update",
        before: "Old prompt",
        after: "New improved prompt",
        reason: "Low success rate",
      });

      const candidates = learner.getRewriteCandidates();
      expect(candidates).toHaveLength(1);

      const result = await learner.processRewriteCandidate("rewrite-test", "approve");
      expect(result).toBe(true);

      const pending = learner.getRewriteCandidates();
      expect(pending).toHaveLength(0);
    });

    it("rejects rewrite candidate", async () => {
      const skill = {
        name: "reject-test",
        version: "1.0.0",
        description: "Test skill",
        triggers: [{ type: "command", value: "/test" }],
        tools: ["file_read"],
        prompt: "Prompt",
        examples: [],
      };
      registry.register(skill);

      learner.addToRewritePool(skill, {
        type: "description_update",
        before: "Old desc",
        after: "New desc",
        reason: "Unclear description",
      });

      const result = await learner.processRewriteCandidate("reject-test", "reject");
      expect(result).toBe(true);

      const pending = learner.getRewriteCandidates();
      expect(pending).toHaveLength(0);
    });

    it("prevents duplicate entries in pool", () => {
      const skill = {
        name: "duplicate-test",
        version: "1.0.0",
        description: "Test",
        triggers: [{ type: "command", value: "/dup" }],
        tools: ["file_read"],
        prompt: "Prompt",
        examples: [],
      };

      learner.addToRewritePool(skill, {
        type: "prompt_update",
        before: "A",
        after: "B",
        reason: "Test",
      });

      learner.addToRewritePool(skill, {
        type: "prompt_update",
        before: "A",
        after: "B",
        reason: "Test again",
      });

      const candidates = learner.getRewriteCandidates();
      expect(candidates).toHaveLength(1);
    });
  });

  describe("nudge system", () => {
    it("returns nudge message when candidates pending", async () => {
      // First create a pending candidate
      const task: CompletedTask = {
        id: "t6",
        description: "Complex refactoring task",
        messages: [
          { role: "user", content: "refactor" },
          { role: "assistant", content: "Step 1" },
          { role: "assistant", content: "Step 2" },
          { role: "assistant", content: "Step 3" },
        ],
        tools_used: ["file_read", "file_write", "shell_execute", "git_status"],
        success: true,
      };
      const candidate = await learner.evaluateForCreation(task);
      expect(candidate).not.toBeNull(); // Verify candidate was created

      learner.scheduleNudge(10);
      const nudge = learner.onAgentStep();
      expect(nudge).toBeNull(); // Not yet time (step 1)

      // Simulate 10 steps (steps 2-10)
      for (let i = 0; i < 8; i++) learner.onAgentStep(); // steps 2-9
      const nudge9 = learner.onAgentStep(); // step 10
      expect(nudge9).toBeTruthy();
      expect(nudge9).toContain("💡 I noticed a pattern");
      expect(nudge9).toContain("complex-refactoring-task");
    });
  });
});
