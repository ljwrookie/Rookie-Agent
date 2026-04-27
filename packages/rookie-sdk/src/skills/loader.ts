import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { SkillMd, SkillMdFrontmatter, Skill } from "./types.js";

const execAsync = promisify(exec);

/**
 * SkillLoader: parses SKILL.md files with YAML frontmatter
 * and shell command preprocessing (`!`command`` syntax).
 *
 * SKILL.md format:
 * ```
 * ---
 * name: fix-issue
 * description: Fix a GitHub issue by number
 * allowed-tools: shell_execute file_read file_write
 * context: inline
 * ---
 * Fix GitHub issue $ARGUMENTS ...
 * ## Environment
 * - Git branch: !`git branch --show-current`
 * ```
 */
export class SkillLoader {
  private cache = new Map<string, SkillMd>();

  /**
   * Parse a single SKILL.md file.
   */
  async parseFile(filePath: string): Promise<SkillMd> {
    const content = await fs.readFile(filePath, "utf-8");
    return this.parse(content, filePath);
  }

  /**
   * Parse SKILL.md content string.
   */
  parse(content: string, sourcePath: string): SkillMd {
    const { frontmatter, body } = this.extractFrontmatter(content);
    return {
      frontmatter,
      prompt: body,
      sourcePath,
    };
  }

  /**
   * Resolve a SKILL.md: parse + execute shell preprocessing.
   * The `!`command`` syntax in the prompt body is replaced with the command output.
   */
  async resolve(skillMd: SkillMd, cwd?: string): Promise<SkillMd> {
    const resolvedPrompt = await this.preprocessShellCommands(
      skillMd.prompt,
      cwd || path.dirname(skillMd.sourcePath)
    );
    return { ...skillMd, resolvedPrompt };
  }

  /**
   * Load all SKILL.md files from a directory tree.
   * Expects structure: <dir>/<skill-name>/SKILL.md
   */
  async loadDirectory(dir: string): Promise<SkillMd[]> {
    const skills: SkillMd[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillFile = path.join(dir, entry.name, "SKILL.md");
        try {
          await fs.access(skillFile);
          const skill = await this.parseFile(skillFile);
          skills.push(skill);
          this.cache.set(skill.frontmatter.name, skill);
        } catch {
          // No SKILL.md in this directory, skip
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return skills;
  }

  /**
   * Load from all three tiers: personal, project, plugin.
   * Later tiers override earlier ones by name.
   */
  async loadAll(projectRoot: string): Promise<Map<string, SkillMd>> {
    const merged = new Map<string, SkillMd>();
    const home = process.env["HOME"] || process.env["USERPROFILE"] || "~";

    // Tier 1: Personal (~/.rookie/skills/)
    const personalDir = path.join(home, ".rookie", "skills");
    for (const skill of await this.loadDirectory(personalDir)) {
      merged.set(skill.frontmatter.name, skill);
    }

    // Tier 2: Project (.rookie/skills/)
    const projectDir = path.join(projectRoot, ".rookie", "skills");
    for (const skill of await this.loadDirectory(projectDir)) {
      merged.set(skill.frontmatter.name, skill);
    }

    return merged;
  }

  /**
   * Convert a parsed SkillMd into the Skill interface used by SkillRegistry.
   */
  toSkill(skillMd: SkillMd): Skill {
    const fm = skillMd.frontmatter;
    return {
      name: fm.name,
      version: "1.0.0",
      description: fm.description,
      triggers: [
        { type: "command", value: `/${fm.name}` },
        { type: "intent", value: fm.description.toLowerCase() },
      ],
      tools: fm["allowed-tools"]?.split(/\s+/) || [],
      prompt: skillMd.resolvedPrompt || skillMd.prompt,
      examples: [],
      metadata: {
        context: fm.context || "inline",
        agent: fm.agent,
        model: fm.model || "inherit",
        disableModelInvocation: fm["disable-model-invocation"] || false,
        userInvocable: fm["user-invocable"] !== false,
        sourcePath: skillMd.sourcePath,
      },
    };
  }

  // ── Internal ────────────────────────────────────────────

  private extractFrontmatter(content: string): {
    frontmatter: SkillMdFrontmatter;
    body: string;
  } {
    const fmRegex = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
    const match = content.match(fmRegex);

    if (!match) {
      throw new Error("SKILL.md must start with YAML frontmatter between --- delimiters");
    }

    const yamlStr = match[1];
    const body = match[2].trim();

    // Simple YAML parser (avoids external dependency)
    const frontmatter = this.parseSimpleYaml(yamlStr) as unknown as SkillMdFrontmatter;

    if (!frontmatter.name) {
      throw new Error("SKILL.md frontmatter must include 'name' field");
    }
    if (!frontmatter.description) {
      throw new Error("SKILL.md frontmatter must include 'description' field");
    }

    return { frontmatter, body };
  }

  /**
   * Simple YAML parser for flat key-value pairs.
   * Handles string, boolean, and number values.
   * Does NOT support nested objects or arrays.
   */
  private parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const line of yaml.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const colonIdx = trimmed.indexOf(":");
      if (colonIdx === -1) continue;

      const key = trimmed.slice(0, colonIdx).trim();
      let value: unknown = trimmed.slice(colonIdx + 1).trim();

      // Type coercion
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (value === "null" || value === "") value = undefined;
      else if (!isNaN(Number(value)) && value !== "") value = Number(value);

      result[key] = value;
    }

    return result;
  }

  /**
   * Replace `!`command`` patterns in the prompt body with their shell output.
   * Example: `!`git branch --show-current`` → `main`
   */
  private async preprocessShellCommands(
    prompt: string,
    cwd: string
  ): Promise<string> {
    // Match !`...` patterns (backtick-wrapped shell commands preceded by !)
    const shellPattern = /!\`([^`]+)\`/g;
    const matches = [...prompt.matchAll(shellPattern)];

    if (matches.length === 0) return prompt;

    let resolved = prompt;
    for (const match of matches) {
      const command = match[1];
      try {
        const { stdout } = await execAsync(command, {
          cwd,
          timeout: 5000,
          maxBuffer: 64 * 1024,
        });
        resolved = resolved.replace(match[0], stdout.trim());
      } catch {
        // Command failed — leave placeholder with error hint
        resolved = resolved.replace(match[0], `<error: ${command} failed>`);
      }
    }

    return resolved;
  }
}
