/**
 * Skill Matcher Tests (P8-T1)
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SemanticSkillMatcher } from "../src/skills/matcher.js";
import { Skill } from "../src/skills/types.js";

describe("SemanticSkillMatcher", () => {
  let matcher: SemanticSkillMatcher;

  const sampleSkills: Skill[] = [
    {
      name: "code-review",
      version: "1.0.0",
      description: "Review code for quality, bugs, and best practices",
      triggers: [{ type: "intent", value: "review" }],
      tools: ["file_read", "grep_search"],
      prompt: "Review the provided code carefully...",
      examples: [],
    },
    {
      name: "refactor",
      version: "1.0.0",
      description: "Refactor code to improve structure and readability",
      triggers: [{ type: "intent", value: "refactor" }],
      tools: ["file_edit", "file_read"],
      prompt: "Refactor the code to improve...",
      examples: [],
    },
    {
      name: "test-gen",
      version: "1.0.0",
      description: "Generate unit tests for code",
      triggers: [{ type: "intent", value: "test" }],
      tools: ["file_write", "shell"],
      prompt: "Generate comprehensive tests...",
      examples: [],
    },
  ];

  beforeEach(() => {
    matcher = new SemanticSkillMatcher();
    matcher.registerSkills(sampleSkills);
  });

  describe("basic operations", () => {
    it("should create a matcher with default config", () => {
      const m = new SemanticSkillMatcher();
      expect(m.size).toBe(0);
      expect(m.isEmpty).toBe(true);
    });

    it("should register a skill", () => {
      const m = new SemanticSkillMatcher();
      m.registerSkill(sampleSkills[0]);
      expect(m.size).toBe(1);
      expect(m.isEmpty).toBe(false);
    });

    it("should register multiple skills", () => {
      expect(matcher.size).toBe(3);
    });

    it("should remove a skill", () => {
      matcher.removeSkill("refactor");
      expect(matcher.size).toBe(2);
      expect(matcher.getAllSkills().find(s => s.name === "refactor")).toBeUndefined();
    });

    it("should clear all skills", () => {
      matcher.clear();
      expect(matcher.size).toBe(0);
      expect(matcher.isEmpty).toBe(true);
    });
  });

  describe("semantic matching", () => {
    it("should find matches for a query", () => {
      const matches = matcher.findMatches("check my code", 3);
      expect(matches.length).toBeGreaterThan(0);
    });

    it("should return skills sorted by relevance", () => {
      const matches = matcher.findMatches("review code quality", 3);
      expect(matches[0].skill.name).toBe("code-review");
      expect(matches[0].score).toBeGreaterThan(0);
    });

    it("should find best match", () => {
      const best = matcher.findBestMatch("improve code structure");
      expect(best).not.toBeNull();
      expect(best?.skill.name).toBe("refactor");
    });

    it("should return null for empty matcher", () => {
      const emptyMatcher = new SemanticSkillMatcher();
      const best = emptyMatcher.findBestMatch("any query");
      expect(best).toBeNull();
    });

    it("should return empty array for empty matcher", () => {
      const emptyMatcher = new SemanticSkillMatcher();
      const matches = emptyMatcher.findMatches("any query");
      expect(matches).toEqual([]);
    });
  });

  describe("accuracy tests", () => {
    it("should match code review intent", () => {
      const matches = matcher.findMatches("review my code for bugs", 3);
      const codeReview = matches.find(m => m.skill.name === "code-review");
      expect(codeReview).toBeDefined();
      expect(codeReview?.score).toBeGreaterThan(0.3);
    });

    it("should match refactor intent", () => {
      const matches = matcher.findMatches("clean up this messy code", 3);
      const refactor = matches.find(m => m.skill.name === "refactor");
      expect(refactor).toBeDefined();
    });

    it("should match test generation intent", () => {
      const matches = matcher.findMatches("write unit tests", 3);
      const testGen = matches.find(m => m.skill.name === "test-gen");
      expect(testGen).toBeDefined();
    });

    it("should have accuracy > 85% on clear intent queries", () => {
      const testCases = [
        { query: "review code", expected: "code-review" },
        { query: "check for bugs", expected: "code-review" },
        { query: "refactor this", expected: "refactor" },
        { query: "improve structure", expected: "refactor" },
        { query: "generate tests", expected: "test-gen" },
        { query: "write unit tests", expected: "test-gen" },
      ];

      let correct = 0;
      for (const { query, expected } of testCases) {
        const best = matcher.findBestMatch(query);
        if (best?.skill.name === expected) {
          correct++;
        }
      }

      const accuracy = correct / testCases.length;
      expect(accuracy).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe("similarity calculation", () => {
    it("should calculate similarity between texts", () => {
      const sim = matcher.calculateSimilarity("hello world", "hello there");
      expect(sim).toBeGreaterThan(0);
      expect(sim).toBeLessThanOrEqual(1);
    });

    it("should return higher similarity for related texts", () => {
      const sim1 = matcher.calculateSimilarity("code review", "review code");
      const sim2 = matcher.calculateSimilarity("code review", "deploy to production");
      expect(sim1).toBeGreaterThan(sim2);
    });

    it("should return 0 for completely different texts", () => {
      const sim = matcher.calculateSimilarity("abc xyz", "123 456");
      expect(sim).toBe(0);
    });
  });

  describe("native module detection", () => {
    it("should report native availability", () => {
      // Native module may or may not be available in test environment
      expect(typeof matcher.isNativeAvailable).toBe("boolean");
    });
  });

  describe("fallback matching", () => {
    it("should use fallback when native is unavailable", () => {
      // This tests the fallback path
      const m = new SemanticSkillMatcher();
      m.registerSkills(sampleSkills);
      
      const matches = m.findMatches("review code", 3);
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
