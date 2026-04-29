/**
 * Skill Manifest Standard (P8-T4)
 * 
 * Standardized skill manifest format for distribution and installation.
 */

import { Skill, Trigger, Example } from "./types.js";

// ─── Manifest Types ────────────────────────────────────────────────

export interface SkillManifestV1 {
  /** Manifest schema version */
  schemaVersion: "1.0";
  
  /** Skill metadata */
  skill: {
    /** Unique skill identifier (reverse domain notation recommended) */
    id: string;
    
    /** Display name */
    name: string;
    
    /** Semantic version */
    version: string;
    
    /** Short description (max 100 chars) */
    description: string;
    
    /** Long description (markdown supported) */
    longDescription?: string;
    
    /** Author information */
    author?: {
      name: string;
      email?: string;
      url?: string;
    };
    
    /** License SPDX identifier */
    license?: string;
    
    /** Homepage URL */
    homepage?: string;
    
    /** Repository URL */
    repository?: string;
    
    /** Keywords for discovery */
    keywords?: string[];
    
    /** Categories */
    categories?: string[];
    
    /** Triggers for activation */
    triggers: Trigger[];
    
    /** Tools required by this skill */
    tools: string[];
    
    /** Optional tools (soft dependencies) */
    optionalTools?: string[];
    
    /** Main prompt template */
    prompt: string;
    
    /** Example usage */
    examples: Example[];
    
    /** Entry point for code-based skills */
    entry?: string;
    
    /** Icon URL or emoji */
    icon?: string;
  };
  
  /** Distribution information */
  dist: {
    /** Package format */
    format: "json" | "tar.gz" | "zip";
    
    /** Entry file (relative to package root) */
    entry: string;
    
    /** Files included in the package */
    files?: string[];
    
    /** Checksum for integrity verification */
    checksum?: {
      algorithm: "sha256" | "sha512";
      value: string;
    };
    
    /** Package size in bytes */
    size?: number;
  };
  
  /** Dependencies */
  dependencies: {
    /** Required Rookie version (semver range) */
    rookie?: string;
    
    /** Required skills (id@version) */
    skills?: string[];
    
    /** Required plugins (name@version) */
    plugins?: string[];
    
    /** System requirements */
    system?: {
      /** Required OS */
      os?: string[];
      
      /** Required shell */
      shell?: string[];
      
      /** Required binaries in PATH */
      binaries?: string[];
    };
  };
  
  /** Permissions required */
  permissions: {
    /** File system permissions */
    file?: ("read" | "write" | "execute")[];
    
    /** Network permissions */
    network?: ("fetch" | "websocket")[];
    
    /** Shell permissions */
    shell?: ("execute" | "spawn")[];
    
    /** Git permissions */
    git?: ("read" | "write")[];
    
    /** Memory access */
    memory?: ("read" | "write")[];
  };
  
  /** Quality metrics */
  quality?: {
    /** Test coverage percentage */
    testCoverage?: number;
    
    /** Usage count (from registry) */
    usageCount?: number;
    
    /** Average rating (1-5) */
    rating?: number;
    
    /** Last verified date */
    lastVerified?: string;
  };
  
  /** Timestamps */
  timestamps: {
    created: string;
    updated: string;
    published?: string;
  };
}

export type SkillManifest = SkillManifestV1;

// ─── Manifest Validation ───────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  field: string;
  message: string;
  code: string;
}

export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

export class ManifestValidator {
  validate(manifest: unknown): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!manifest || typeof manifest !== "object") {
      return {
        valid: false,
        errors: [{ field: "", message: "Manifest must be an object", code: "INVALID_TYPE" }],
        warnings: [],
      };
    }

    const m = manifest as Record<string, unknown>;

    // Check schema version
    if (m.schemaVersion !== "1.0") {
      errors.push({
        field: "schemaVersion",
        message: `Unsupported schema version: ${m.schemaVersion}. Expected "1.0"`,
        code: "UNSUPPORTED_VERSION",
      });
    }

    // Validate skill section
    this.validateSkill(m.skill as Record<string, unknown>, errors, warnings);

    // Validate dist section
    this.validateDist(m.dist as Record<string, unknown>, errors, warnings);

    // Validate dependencies
    this.validateDependencies(m.dependencies as Record<string, unknown>, errors, warnings);

    // Validate permissions
    this.validatePermissions(m.permissions as Record<string, unknown>, errors, warnings);

    // Validate timestamps
    this.validateTimestamps(m.timestamps as Record<string, unknown>, errors, warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateSkill(
    skill: Record<string, unknown> | undefined,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!skill) {
      errors.push({ field: "skill", message: "Missing skill section", code: "MISSING_FIELD" });
      return;
    }

    // ID validation
    if (!skill.id) {
      errors.push({ field: "skill.id", message: "Skill ID is required", code: "MISSING_FIELD" });
    } else if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(skill.id as string)) {
      warnings.push({
        field: "skill.id",
        message: "Skill ID should follow reverse domain notation (e.g., 'author/skill-name')",
        suggestion: "Use format: author-name/skill-name",
      });
    }

    // Name validation
    if (!skill.name) {
      errors.push({ field: "skill.name", message: "Skill name is required", code: "MISSING_FIELD" });
    }

    // Version validation (semver)
    if (!skill.version) {
      errors.push({ field: "skill.version", message: "Version is required", code: "MISSING_FIELD" });
    } else if (!this.isValidSemver(skill.version as string)) {
      errors.push({
        field: "skill.version",
        message: "Version must be valid semver",
        code: "INVALID_VERSION",
      });
    }

    // Description validation
    if (!skill.description) {
      errors.push({ field: "skill.description", message: "Description is required", code: "MISSING_FIELD" });
    } else if ((skill.description as string).length > 100) {
      warnings.push({
        field: "skill.description",
        message: "Description exceeds 100 characters",
        suggestion: "Use longDescription for detailed information",
      });
    }

    // Triggers validation
    if (!Array.isArray(skill.triggers) || skill.triggers.length === 0) {
      errors.push({
        field: "skill.triggers",
        message: "At least one trigger is required",
        code: "MISSING_FIELD",
      });
    }

    // Tools validation
    if (!Array.isArray(skill.tools)) {
      errors.push({ field: "skill.tools", message: "Tools must be an array", code: "INVALID_TYPE" });
    }

    // Prompt validation
    if (!skill.prompt) {
      errors.push({ field: "skill.prompt", message: "Prompt is required", code: "MISSING_FIELD" });
    }

    // Examples validation
    if (!Array.isArray(skill.examples) || skill.examples.length === 0) {
      warnings.push({
        field: "skill.examples",
        message: "No examples provided",
        suggestion: "Add at least one example to help users understand the skill",
      });
    }
  }

  private validateDist(
    dist: Record<string, unknown> | undefined,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    if (!dist) {
      errors.push({ field: "dist", message: "Missing dist section", code: "MISSING_FIELD" });
      return;
    }

    const validFormats = ["json", "tar.gz", "zip"];
    if (!validFormats.includes(dist.format as string)) {
      errors.push({
        field: "dist.format",
        message: `Invalid format: ${dist.format}. Must be one of: ${validFormats.join(", ")}`,
        code: "INVALID_VALUE",
      });
    }

    if (!dist.entry) {
      errors.push({ field: "dist.entry", message: "Entry point is required", code: "MISSING_FIELD" });
    }
  }

  private validateDependencies(
    deps: Record<string, unknown> | undefined,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    if (!deps) return;

    // Validate Rookie version requirement
    if (deps.rookie && !this.isValidSemverRange(deps.rookie as string)) {
      errors.push({
        field: "dependencies.rookie",
        message: "Invalid semver range for Rookie version",
        code: "INVALID_VERSION",
      });
    }
  }

  private validatePermissions(
    perms: Record<string, unknown> | undefined,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (!perms) {
      errors.push({ field: "permissions", message: "Permissions section is required", code: "MISSING_FIELD" });
      return;
    }

    // Warn if no permissions specified (unusual)
    const hasAnyPermission = Object.values(perms).some(
      v => Array.isArray(v) && v.length > 0
    );
    
    if (!hasAnyPermission) {
      warnings.push({
        field: "permissions",
        message: "No permissions specified",
        suggestion: "Explicitly declare required permissions",
      });
    }
  }

  private validateTimestamps(
    timestamps: Record<string, unknown> | undefined,
    errors: ValidationError[],
    _warnings: ValidationWarning[]
  ): void {
    if (!timestamps) {
      errors.push({ field: "timestamps", message: "Timestamps section is required", code: "MISSING_FIELD" });
      return;
    }

    const required = ["created", "updated"];
    for (const field of required) {
      if (!timestamps[field]) {
        errors.push({ field: `timestamps.${field}`, message: `${field} timestamp is required`, code: "MISSING_FIELD" });
      } else if (!this.isValidISO8601(timestamps[field] as string)) {
        errors.push({
          field: `timestamps.${field}`,
          message: `Invalid ISO 8601 timestamp: ${timestamps[field]}`,
          code: "INVALID_FORMAT",
        });
      }
    }
  }

  private isValidSemver(version: string): boolean {
    // Basic semver validation
    return /^\d+\.\d+\.\d+/.test(version);
  }

  private isValidSemverRange(range: string): boolean {
    // Basic semver range validation
    return /^(\^|~|>=|<=|>|<)?\d+\.\d+\.\d+/.test(range) || range === "*";
  }

  private isValidISO8601(date: string): boolean {
    return !isNaN(Date.parse(date));
  }
}

// ─── Manifest Utilities ────────────────────────────────────────────

export function createManifest(
  skill: Skill,
  options: {
    id: string;
    author?: { name: string; email?: string };
    license?: string;
    keywords?: string[];
    categories?: string[];
  }
): SkillManifest {
  const now = new Date().toISOString();

  return {
    schemaVersion: "1.0",
    skill: {
      id: options.id,
      name: skill.name,
      version: skill.version,
      description: skill.description,
      author: options.author,
      license: options.license || "MIT",
      keywords: options.keywords || [],
      categories: options.categories || [],
      triggers: skill.triggers,
      tools: skill.tools,
      prompt: skill.prompt,
      examples: skill.examples,
    },
    dist: {
      format: "json",
      entry: "skill.json",
    },
    dependencies: {
      rookie: ">=0.1.0",
    },
    permissions: {
      file: ["read"],
      memory: ["read"],
    },
    timestamps: {
      created: now,
      updated: now,
    },
  };
}

export function skillToManifest(skill: Skill, id: string): SkillManifest {
  return createManifest(skill, { id });
}

export function manifestToSkill(manifest: SkillManifest): Skill {
  return {
    name: manifest.skill.name,
    version: manifest.skill.version,
    description: manifest.skill.description,
    triggers: manifest.skill.triggers,
    tools: manifest.skill.tools,
    prompt: manifest.skill.prompt,
    examples: manifest.skill.examples,
    metadata: {
      manifestId: manifest.skill.id,
      author: manifest.skill.author,
      license: manifest.skill.license,
      keywords: manifest.skill.keywords,
      categories: manifest.skill.categories,
    },
  };
}

export function updateManifestVersion(
  manifest: SkillManifest,
  newVersion: string
): SkillManifest {
  const prev = manifest.timestamps.updated;
  let updated = new Date().toISOString();
  // Ensure monotonicity for fast successive updates in the same millisecond.
  if (updated === prev) {
    const t = Date.parse(prev);
    if (!Number.isNaN(t)) {
      updated = new Date(t + 1).toISOString();
    } else {
      // Fallback: append a stable suffix if parsing fails.
      updated = `${prev}-1`;
    }
  }
  return {
    ...manifest,
    skill: {
      ...manifest.skill,
      version: newVersion,
    },
    timestamps: {
      ...manifest.timestamps,
      updated,
    },
  };
}
