/**
 * Skill Matcher - TypeScript wrapper for Rust semantic matching engine
 * 
 * Provides semantic skill matching using the Rust HNSW index backend.
 * Falls back to basic matching if native module is unavailable.
 */

import { Skill, SkillEntry } from "./types.js";

export interface SemanticMatchResult {
  skill: Skill;
  score: number;
  rank: number;
}

export interface MatcherConfig {
  dimension?: number;
  seed?: number;
  enableCache?: boolean;
}

// Native module interface (loaded dynamically)
interface NativeSkillMatcher {
  addSkill(id: string, name: string, description: string, metadataJson?: string): void;
  removeSkill(id: string): boolean;
  findMatches(query: string, topK?: number): Array<{
    skill: {
      id: string;
      name: string;
      description: string;
      metadata?: string;
    };
    score: number;
    rank: number;
  }>;
  findBestMatch(query: string): {
    skill: {
      id: string;
      name: string;
      description: string;
      metadata?: string;
    };
    score: number;
    rank: number;
  } | null;
  calculateSimilarity(text1: string, text2: string): number;
  len(): number;
  isEmpty(): boolean;
}

let nativeModule: { SkillMatcher: new (config?: { dimension?: number; seed?: number }) => NativeSkillMatcher } | null = null;

// Try to load native module
try {
  // Dynamic import to handle optional native dependency
  const rookieCore = require("@rookie/core");
  if (rookieCore?.SkillMatcher) {
    nativeModule = rookieCore;
  }
} catch {
  // Native module not available, will use fallback
}

/**
 * Semantic skill matcher using Rust HNSW index
 */
export class SemanticSkillMatcher {
  private native: NativeSkillMatcher | null = null;
  private skills: Map<string, Skill> = new Map();
  private config: Required<MatcherConfig>;

  constructor(config: MatcherConfig = {}) {
    this.config = {
      dimension: config.dimension ?? 128,
      seed: config.seed ?? 42,
      enableCache: config.enableCache ?? true,
    };

    if (nativeModule) {
      try {
        this.native = new nativeModule.SkillMatcher({
          dimension: this.config.dimension,
          seed: this.config.seed,
        });
      } catch (error) {
        console.warn("Failed to initialize native skill matcher:", error);
      }
    }
  }

  /**
   * Check if native Rust matcher is available
   */
  get isNativeAvailable(): boolean {
    return this.native !== null;
  }

  /**
   * Register a skill for semantic matching
   */
  registerSkill(skill: Skill): void {
    this.skills.set(skill.name, skill);

    if (this.native) {
      try {
        const metadata = {
          triggers: skill.triggers,
          tools: skill.tools,
          version: skill.version,
        };
        
        this.native.addSkill(
          skill.name,
          skill.name,
          skill.description,
          JSON.stringify(metadata)
        );
      } catch (error) {
        console.warn(`Failed to add skill "${skill.name}" to native matcher:`, error);
      }
    }
  }

  /**
   * Remove a skill from matching
   */
  removeSkill(name: string): boolean {
    const existed = this.skills.delete(name);
    
    if (this.native) {
      try {
        this.native.removeSkill(name);
      } catch (error) {
        console.warn(`Failed to remove skill "${name}" from native matcher:`, error);
      }
    }
    
    return existed;
  }

  /**
   * Find semantically matching skills
   */
  findMatches(query: string, topK: number = 5): SemanticMatchResult[] {
    // Use native matcher if available
    if (this.native) {
      try {
        const results = this.native.findMatches(query, topK);
        return results.map(r => {
          const skill = this.skills.get(r.skill.id);
          if (!skill) {
            // Fallback: reconstruct from native result
            return {
              skill: {
                name: r.skill.id,
                description: r.skill.description,
                version: "1.0.0",
                triggers: [],
                tools: [],
                prompt: "",
                examples: [],
              },
              score: r.score,
              rank: r.rank,
            };
          }
          return { skill, score: r.score, rank: r.rank };
        });
      } catch (error) {
        console.warn("Native matcher failed, falling back:", error);
      }
    }

    // Fallback: basic keyword matching
    return this.fallbackMatching(query, topK);
  }

  /**
   * Find the best matching skill
   */
  findBestMatch(query: string): SemanticMatchResult | null {
    const matches = this.findMatches(query, 1);
    return matches[0] ?? null;
  }

  /**
   * Calculate semantic similarity between two texts
   */
  calculateSimilarity(text1: string, text2: string): number {
    if (this.native) {
      try {
        return this.native.calculateSimilarity(text1, text2);
      } catch (error) {
        console.warn("Native similarity calculation failed:", error);
      }
    }

    // Fallback: simple Jaccard similarity
    return this.fallbackSimilarity(text1, text2);
  }

  /**
   * Get all registered skills
   */
  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get number of registered skills
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * Check if matcher has no skills
   */
  get isEmpty(): boolean {
    return this.skills.size === 0;
  }

  /**
   * Batch register multiple skills
   */
  registerSkills(skills: Skill[]): void {
    for (const skill of skills) {
      this.registerSkill(skill);
    }
  }

  /**
   * Clear all registered skills
   */
  clear(): void {
    this.skills.clear();
    // Note: Native matcher doesn't support clear, would need to recreate
    if (this.native && nativeModule) {
      try {
        this.native = new nativeModule.SkillMatcher({
          dimension: this.config.dimension,
          seed: this.config.seed,
        });
      } catch (error) {
        console.warn("Failed to recreate native matcher:", error);
        this.native = null;
      }
    }
  }

  // ─── Fallback implementations ───────────────────────────────

  private fallbackMatching(query: string, topK: number): SemanticMatchResult[] {
    const queryTokens = tokenize(query);
    const expandedQuery = expandTokens(queryTokens);

    const scored = Array.from(this.skills.values()).map((skill) => {
      const skillTokens = buildSkillTokens(skill);
      const overlap = intersectionSize(expandedQuery, skillTokens);

      // Trigger-aware boost: if query hits any trigger intent/pattern keywords, rank higher.
      const triggerBoost = matchesTrigger(expandedQuery, skill) ? 0.6 : 0;

      // Normalize overlap against query size so short queries can still score well.
      const overlapScore = expandedQuery.size === 0 ? 0 : (overlap / expandedQuery.size) * 0.4;

      const score = triggerBoost + overlapScore;
      return { skill, score };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored
      .slice(0, topK)
      .map((item, index) => ({
        skill: item.skill,
        score: item.score,
        rank: index + 1,
      }));
  }

  private fallbackSimilarity(text1: string, text2: string): number {
    const words1 = tokenize(text1);
    const words2 = tokenize(text2);
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tokenization + lightweight synonym expansion (fallback path)
// ─────────────────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "with",
]);

// Intent-centric synonyms; keep small and deterministic for tests.
const SYNONYMS: Record<string, string[]> = {
  review: ["review", "check", "inspect", "audit"],
  bug: ["bug", "bugs", "issue", "issues"],
  refactor: ["refactor", "cleanup", "clean", "restructure", "simplify", "messy"],
  improve: ["improve", "optimize", "better"],
  structure: ["structure", "readability", "maintainability"],
  test: ["test", "tests", "unit", "spec", "coverage"],
  generate: ["generate", "write", "create"],
};

function tokenize(text: string): Set<string> {
  const parts = text
    .toLowerCase()
    // split on non-alphanumeric (treat hyphens/underscores as separators)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !STOPWORDS.has(t));

  // Light stemming for plural "s".
  const normalized = parts.map((t) => (t.endsWith("s") && t.length > 3 ? t.slice(0, -1) : t));
  return new Set(normalized);
}

function expandTokens(tokens: Set<string>): Set<string> {
  const out = new Set<string>(tokens);
  for (const t of tokens) {
    for (const [key, syns] of Object.entries(SYNONYMS)) {
      if (syns.includes(t) || key === t) {
        out.add(key);
        for (const s of syns) out.add(s);
      }
    }
  }
  return out;
}

function buildSkillTokens(skill: Skill): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(skill.name)) out.add(t);
  for (const t of tokenize(skill.description)) out.add(t);
  for (const trig of skill.triggers) {
    for (const t of tokenize(String((trig as any).value ?? ""))) out.add(t);
  }
  // Expand to include intent synonyms.
  return expandTokens(out);
}

function matchesTrigger(queryTokens: Set<string>, skill: Skill): boolean {
  for (const trig of skill.triggers) {
    const v = String((trig as any).value ?? "");
    const tks = expandTokens(tokenize(v));
    if (intersectionSize(queryTokens, tks) > 0) return true;
  }
  return false;
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) {
    if (b.has(x)) n++;
  }
  return n;
}

/**
 * Create a skill entry from a Skill
 */
export function skillToEntry(skill: Skill): SkillEntry {
  return {
    id: skill.name,
    name: skill.name,
    description: skill.description,
    triggers: skill.triggers,
    tools: skill.tools,
    metadata: skill.metadata,
  };
}

/**
 * Pre-computed skill embeddings for fast loading
 */
export interface SkillEmbeddings {
  version: string;
  generatedAt: string;
  dimension: number;
  embeddings: Array<{
    skillId: string;
    vector: number[];
  }>;
}

/**
 * Export skill embeddings for caching
 */
export function exportEmbeddings(
  _matcher: SemanticSkillMatcher,
  version: string
): SkillEmbeddings {
  return {
    version,
    generatedAt: new Date().toISOString(),
    dimension: 128,
    embeddings: [], // Would need native support for this
  };
}
