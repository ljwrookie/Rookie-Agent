import * as fs from "fs/promises";
import * as path from "path";
import { Skill, SkillManifest, CompletedTask } from "./types.js";
import { SkillLoader } from "./loader.js";
import { SemanticSkillMatcher, SemanticMatchResult } from "./matcher.js";

export interface SkillRegistryOptions {
  storageDir?: string;
  enableSemanticMatching?: boolean;
  semanticMatcherConfig?: {
    dimension?: number;
    seed?: number;
  };
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();
  private storageDir: string;
  private loader: SkillLoader;
  private watchAbort: AbortController | null = null;
  private semanticMatcher: SemanticSkillMatcher | null = null;
  private enableSemanticMatching: boolean;

  constructor(options: SkillRegistryOptions = {}) {
    this.storageDir = options.storageDir || path.join(process.cwd(), ".rookie", "skills");
    this.loader = new SkillLoader();
    this.enableSemanticMatching = options.enableSemanticMatching ?? true;
    
    if (this.enableSemanticMatching) {
      this.semanticMatcher = new SemanticSkillMatcher({
        dimension: options.semanticMatcherConfig?.dimension ?? 128,
        seed: options.semanticMatcherConfig?.seed ?? 42,
      });
    }
  }

  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
    this.semanticMatcher?.registerSkill(skill);
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  remove(name: string): boolean {
    this.semanticMatcher?.removeSkill(name);
    return this.skills.delete(name);
  }

  /**
   * Find skills using semantic matching (P8).
   * Returns skills sorted by semantic similarity to the query.
   */
  findBySemanticMatch(query: string, topK?: number): SemanticMatchResult[] {
    if (!this.semanticMatcher || this.semanticMatcher.isEmpty) {
      return [];
    }
    return this.semanticMatcher.findMatches(query, topK ?? 5);
  }

  /**
   * Find the best matching skill using semantic matching.
   */
  findBestSemanticMatch(query: string): SemanticMatchResult | null {
    if (!this.semanticMatcher || this.semanticMatcher.isEmpty) {
      return null;
    }
    return this.semanticMatcher.findBestMatch(query);
  }

  /**
   * Check if semantic matching is available (native Rust module loaded).
   */
  get isSemanticMatchingAvailable(): boolean {
    return this.semanticMatcher?.isNativeAvailable ?? false;
  }

  /**
   * Calculate semantic similarity between two texts.
   */
  calculateSimilarity(text1: string, text2: string): number {
    return this.semanticMatcher?.calculateSimilarity(text1, text2) ?? 0;
  }

  /**
   * Find skills whose triggers match the given user input.
   * Falls back to semantic matching if no trigger matches.
   */
  findByTrigger(userInput: string, useSemanticFallback: boolean = true): Skill[] {
    const input = userInput.toLowerCase().trim();
    const triggerMatches = this.list().filter((skill) =>
      skill.triggers.some((t) => {
        switch (t.type) {
          case "command":
            return input === t.value || input.startsWith(t.value + " ");
          case "pattern":
            return new RegExp(t.value, "i").test(input);
          case "intent":
            return input.includes(t.value);
          default:
            return false;
        }
      })
    );

    // If no trigger matches and semantic fallback is enabled, use semantic matching
    if (triggerMatches.length === 0 && useSemanticFallback && this.semanticMatcher) {
      const semanticMatches = this.semanticMatcher.findMatches(userInput, 3);
      // Only return semantic matches with good confidence (> 0.5)
      return semanticMatches
        .filter(m => m.score > 0.5)
        .map(m => m.skill);
    }

    return triggerMatches;
  }

  /**
   * Find a skill by exact name or /command.
   */
  findByName(name: string): Skill | null {
    // Try direct lookup
    const direct = this.skills.get(name);
    if (direct) return direct;

    // Try stripping leading /
    const stripped = name.startsWith("/") ? name.slice(1) : name;
    return this.skills.get(stripped) || null;
  }

  // ── SKILL.md integration (Phase 2) ────────────────────

  /**
   * Load all SKILL.md files from the given directory and register them.
   */
  async loadFromDirectory(dir: string): Promise<void> {
    const skillMds = await this.loader.loadDirectory(dir);
    for (const md of skillMds) {
      const skill = this.loader.toSkill(md);
      this.register(skill);
    }
  }

  /**
   * Load SKILL.md files from all standard tiers (personal + project).
   */
  async loadAll(projectRoot: string): Promise<void> {
    const allSkills = await this.loader.loadAll(projectRoot);
    for (const md of allSkills.values()) {
      const skill = this.loader.toSkill(md);
      this.register(skill);
    }
  }

  /**
   * Resolve shell placeholders in a skill's prompt (Phase 2).
   * Call this before executing a SKILL.md-based skill.
   */
  async resolveSkill(name: string, cwd?: string): Promise<Skill | null> {
    const skill = this.skills.get(name);
    if (!skill) return null;

    const sourcePath = skill.metadata?.["sourcePath"] as string | undefined;
    if (!sourcePath) return skill; // Not a SKILL.md skill, return as-is

    try {
      const md = await this.loader.parseFile(sourcePath);
      const resolved = await this.loader.resolve(md, cwd);
      const resolvedSkill = this.loader.toSkill(resolved);
      // Don't persist the resolved prompt (it's ephemeral)
      return resolvedSkill;
    } catch {
      return skill;
    }
  }

  /**
   * Watch for SKILL.md file changes and auto-reload.
   */
  async watchForChanges(projectRoot: string): Promise<void> {
    // Watch project skills directory
    const watchDir = path.join(projectRoot, ".rookie", "skills");
    try {
      await fs.mkdir(watchDir, { recursive: true });
    } catch {
      return;
    }

    this.watchAbort = new AbortController();
    try {
      const watcher = fs.watch(watchDir, {
        recursive: true,
        signal: this.watchAbort.signal,
      });

      for await (const event of watcher) {
        if (event.filename?.endsWith("SKILL.md")) {
          // Debounce: reload after a brief delay
          await new Promise((r) => setTimeout(r, 200));
          await this.loadFromDirectory(watchDir);
        }
      }
    } catch (e) {
      // AbortError is expected when stopping the watcher
      if ((e as NodeJS.ErrnoException).name !== "AbortError") {
        // Silently ignore other watch errors (e.g. unsupported platform)
      }
    }
  }

  /**
   * Stop watching for file changes.
   */
  stopWatching(): void {
    this.watchAbort?.abort();
    this.watchAbort = null;
  }

  // ── Import/Export ─────────────────────────────────────

  async importFromUrl(url: string): Promise<Skill> {
    let manifest: SkillManifest;

    if (url.startsWith("http")) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch skill from ${url}: ${response.statusText}`);
      }
      manifest = (await response.json()) as SkillManifest;
    } else {
      const content = await fs.readFile(url, "utf-8");
      manifest = JSON.parse(content) as SkillManifest;
    }

    const skill = manifest.skill;
    this.register(skill);
    await this.persist(skill);
    return skill;
  }

  async exportSkill(name: string): Promise<string> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }

    const manifest: SkillManifest = {
      schema_version: "1.0",
      skill,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return JSON.stringify(manifest, null, 2);
  }

  // ── Legacy: create from CompletedTask ─────────────────

  async createFromTask(task: CompletedTask): Promise<Skill> {
    const prompt = this.generatePromptFromTask(task);

    const skill: Skill = {
      name: `skill_${task.id}`,
      version: "1.0.0",
      description: task.description,
      triggers: [{ type: "intent", value: task.description.toLowerCase() }],
      tools: [...new Set(task.tools_used)],
      prompt,
      examples: this.extractExamples(task.messages),
    };

    this.register(skill);
    await this.persist(skill);
    return skill;
  }

  async loadFromDisk(): Promise<void> {
    try {
      const files = await fs.readdir(this.storageDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = await fs.readFile(
            path.join(this.storageDir, file),
            "utf-8"
          );
          const manifest = JSON.parse(content) as SkillManifest;
          this.register(manifest.skill);
        }
      }
    } catch {
      // Directory doesn't exist yet
    }

    // Also load SKILL.md files
    await this.loadFromDirectory(this.storageDir);
  }

  // ── Internal ──────────────────────────────────────────

  private async persist(skill: Skill): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true });
    const manifest: SkillManifest = {
      schema_version: "1.0",
      skill,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await fs.writeFile(
      path.join(this.storageDir, `${skill.name}.json`),
      JSON.stringify(manifest, null, 2)
    );
  }

  private generatePromptFromTask(task: CompletedTask): string {
    return `You are an expert assistant specialized in: ${task.description}

Follow these patterns based on successful task completion:
${task.tools_used.map((t) => `- Use ${t} when appropriate`).join("\n")}

Always ensure accuracy and follow best practices.`;
  }

  private extractExamples(
    messages: Array<{ role: string; content: string }>
  ): Array<{ input: string; output: string }> {
    const examples: Array<{ input: string; output: string }> = [];
    for (let i = 0; i < messages.length - 1; i += 2) {
      if (
        messages[i]?.role === "user" &&
        messages[i + 1]?.role === "assistant"
      ) {
        examples.push({
          input: messages[i].content,
          output: messages[i + 1].content,
        });
      }
    }
    return examples;
  }
}
