/**
 * Skill Installer Tests (P8-T4)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  SkillInstaller,
  InstallResult,
  InstalledSkill,
} from "../src/skills/installer.js";
import { SkillRegistry } from "../src/skills/registry.js";
import {
  ManifestValidator,
  createManifest,
  skillToManifest,
  manifestToSkill,
  updateManifestVersion,
} from "../src/skills/manifest.js";
import { SkillManifest } from "../src/skills/types.js";

describe("ManifestValidator", () => {
  const validator = new ManifestValidator();

  describe("valid manifests", () => {
    it("should validate a correct manifest", () => {
      const manifest: SkillManifest = {
        schemaVersion: "1.0",
        skill: {
          id: "test/skill",
          name: "Test Skill",
          version: "1.0.0",
          description: "A test skill",
          triggers: [{ type: "command", value: "test" }],
          tools: ["file_read"],
          prompt: "Test prompt",
          examples: [],
        },
        dist: {
          format: "json",
          entry: "skill.json",
        },
        dependencies: {},
        permissions: {},
        timestamps: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
      };

      const result = validator.validate(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("invalid manifests", () => {
    it("should reject missing required fields", () => {
      const manifest = {
        schemaVersion: "1.0",
        // missing skill section
      };

      const result = validator.validate(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should reject invalid schema version", () => {
      const manifest: any = {
        schemaVersion: "2.0",
        skill: {
          id: "test/skill",
          name: "Test",
          version: "1.0.0",
          description: "Test",
          triggers: [],
          tools: [],
          prompt: "",
          examples: [],
        },
        dist: { format: "json", entry: "" },
        dependencies: {},
        permissions: {},
        timestamps: { created: "", updated: "" },
      };

      const result = validator.validate(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "schemaVersion")).toBe(true);
    });

    it("should reject invalid semver", () => {
      const manifest: any = {
        schemaVersion: "1.0",
        skill: {
          id: "test/skill",
          name: "Test",
          version: "not-a-version",
          description: "Test",
          triggers: [],
          tools: [],
          prompt: "",
          examples: [],
        },
        dist: { format: "json", entry: "" },
        dependencies: {},
        permissions: {},
        timestamps: { created: "", updated: "" },
      };

      const result = validator.validate(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === "skill.version")).toBe(true);
    });
  });

  describe("warnings", () => {
    it("should warn about missing examples", () => {
      const manifest: any = {
        schemaVersion: "1.0",
        skill: {
          id: "test/skill",
          name: "Test",
          version: "1.0.0",
          description: "Test",
          triggers: [{ type: "command", value: "test" }],
          tools: [],
          prompt: "",
          examples: [],
        },
        dist: { format: "json", entry: "" },
        dependencies: {},
        permissions: {},
        timestamps: { created: new Date().toISOString(), updated: new Date().toISOString() },
      };

      const result = validator.validate(manifest);
      expect(result.warnings.some(w => w.field === "skill.examples")).toBe(true);
    });

    it("should warn about description too long", () => {
      const manifest: any = {
        schemaVersion: "1.0",
        skill: {
          id: "test/skill",
          name: "Test",
          version: "1.0.0",
          description: "a".repeat(150),
          triggers: [{ type: "command", value: "test" }],
          tools: [],
          prompt: "",
          examples: [{ input: "test", output: "result" }],
        },
        dist: { format: "json", entry: "" },
        dependencies: {},
        permissions: {},
        timestamps: { created: new Date().toISOString(), updated: new Date().toISOString() },
      };

      const result = validator.validate(manifest);
      expect(result.warnings.some(w => w.field === "skill.description")).toBe(true);
    });
  });
});

describe("Manifest Utilities", () => {
  const sampleSkill = {
    name: "test-skill",
    version: "1.0.0",
    description: "A test skill",
    triggers: [{ type: "command", value: "test" }],
    tools: ["file_read"],
    prompt: "Test prompt",
    examples: [{ input: "hello", output: "world" }],
  };

  it("should create manifest from skill", () => {
    const manifest = createManifest(sampleSkill, {
      id: "author/test-skill",
      author: { name: "Test Author" },
    });

    expect(manifest.schemaVersion).toBe("1.0");
    expect(manifest.skill.id).toBe("author/test-skill");
    expect(manifest.skill.name).toBe("test-skill");
  });

  it("should convert skill to manifest", () => {
    const manifest = skillToManifest(sampleSkill, "author/test-skill");
    expect(manifest.skill.id).toBe("author/test-skill");
  });

  it("should convert manifest to skill", () => {
    const manifest = createManifest(sampleSkill, { id: "test/skill" });
    const skill = manifestToSkill(manifest);

    expect(skill.name).toBe("test-skill");
    expect(skill.version).toBe("1.0.0");
    expect(skill.metadata?.manifestId).toBe("test/skill");
  });

  it("should update manifest version", () => {
    const manifest = createManifest(sampleSkill, { id: "test/skill" });
    const updated = updateManifestVersion(manifest, "2.0.0");

    expect(updated.skill.version).toBe("2.0.0");
    expect(updated.timestamps.updated).not.toBe(manifest.timestamps.updated);
  });
});

describe("SkillInstaller", () => {
  let tempDir: string;
  let installer: SkillInstaller;
  let registry: SkillRegistry;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rookie-test-"));
    registry = new SkillRegistry({ storageDir: tempDir });
    installer = new SkillInstaller(tempDir, registry);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("list", () => {
    it("should return empty list when no skills installed", async () => {
      const skills = await installer.list();
      expect(skills).toEqual([]);
    });
  });

  describe("install from path", () => {
    it("should fail for non-existent path", async () => {
      const result = await installer.install("/nonexistent/path");
      expect(result.success).toBe(false);
    });

    it("should install from valid manifest file", async () => {
      // Create a temporary skill directory
      const skillDir = path.join(tempDir, "test-skill");
      await fs.mkdir(skillDir, { recursive: true });

      const manifest = {
        schemaVersion: "1.0",
        skill: {
          id: "test/my-skill",
          name: "My Skill",
          version: "1.0.0",
          description: "A test skill",
          triggers: [{ type: "command", value: "my-skill" }],
          tools: [],
          prompt: "Test prompt",
          examples: [],
        },
        dist: { format: "json", entry: "skill.json" },
        dependencies: {},
        permissions: {},
        timestamps: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
      };

      await fs.writeFile(
        path.join(skillDir, "manifest.json"),
        JSON.stringify(manifest, null, 2)
      );

      const result = await installer.install(skillDir);
      expect(result.success).toBe(true);
      expect(result.skill?.name).toBe("My Skill");
    });
  });

  describe("remove", () => {
    it("should fail for non-installed skill", async () => {
      const result = await installer.remove("nonexistent/skill");
      expect(result.success).toBe(false);
    });
  });

  describe("info", () => {
    it("should return null for non-installed skill", async () => {
      const info = await installer.info("nonexistent/skill");
      expect(info).toBeNull();
    });
  });

  describe("search", () => {
    it("should return empty array on error", async () => {
      // With no registry server, search should fail gracefully
      const results = await installer.search("test");
      expect(Array.isArray(results)).toBe(true);
    });
  });
});

describe("SkillRegistry Integration", () => {
  it("should support semantic matching", () => {
    const registry = new SkillRegistry({ enableSemanticMatching: true });
    expect(registry.isSemanticMatchingAvailable).toBeDefined();
  });

  it("should find by semantic match", () => {
    const registry = new SkillRegistry({ enableSemanticMatching: true });
    
    registry.register({
      name: "code-review",
      version: "1.0.0",
      description: "Review code for quality",
      triggers: [],
      tools: [],
      prompt: "",
      examples: [],
    });

    const matches = registry.findBySemanticMatch("check my code");
    expect(matches.length).toBeGreaterThan(0);
  });

  it("should calculate similarity", () => {
    const registry = new SkillRegistry({ enableSemanticMatching: true });
    const sim = registry.calculateSimilarity("hello world", "hello there");
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});
