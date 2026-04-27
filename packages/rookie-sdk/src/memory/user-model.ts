// User Dialect Modeling: Third-layer memory for personalization (P2-T4)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { Message } from "../agent/types.js";

// ─── Types ───────────────────────────────────────────────────────

export interface UserPreferences {
  /** Preferred programming languages */
  languages: string[];
  /** Code style preferences */
  codeStyle: "concise" | "verbose" | "documented" | "minimal";
  /** Testing preferences */
  testing: "tdd" | "after" | "none";
  /** Import style */
  imports: "esm" | "cjs" | "auto";
}

export interface TechStack {
  /** Frameworks the user frequently uses */
  frameworks: string[];
  /** Build tools */
  buildTools: string[];
  /** Package managers */
  packageManagers: string[];
  /** Databases */
  databases: string[];
  /** Cloud providers */
  cloudProviders: string[];
}

export interface CommunicationStyle {
  /** Detail level in responses */
  detailLevel: "brief" | "moderate" | "detailed";
  /** Whether user likes examples */
  likesExamples: boolean;
  /** Whether user prefers code over explanation */
  codeFirst: boolean;
  /** Preferred response format */
  format: "markdown" | "plain" | "structured";
}

export interface UserGoals {
  /** Current project focus */
  currentProject?: string;
  /** Learning goals */
  learning: string[];
  /** Areas of interest */
  interests: string[];
  /** Pain points */
  painPoints: string[];
}

export interface UserModel {
  /** User identifier (hashed) */
  userId: string;
  /** When the model was created */
  createdAt: string;
  /** When the model was last updated */
  updatedAt: string;
  /** Number of sessions analyzed */
  sessionCount: number;
  /** User preferences */
  preferences: UserPreferences;
  /** Technology stack */
  stack: TechStack;
  /** Communication style */
  communication: CommunicationStyle;
  /** Goals and interests */
  goals: UserGoals;
  /** Raw insights from Reflector */
  insights: string[];
}

export interface ReflectorInput {
  /** Recent session messages */
  recentSessions: Message[][];
  /** Current user model (if exists) */
  currentModel?: UserModel;
  /** Session metadata */
  sessionCount: number;
}

export interface ReflectorOutput {
  /** Updated user model fields */
  updates: Partial<Omit<UserModel, "userId" | "createdAt" | "updatedAt" | "sessionCount">>;
  /** New insights to add */
  newInsights: string[];
  /** Confidence score (0-1) */
  confidence: number;
}

export interface UserModelOptions {
  /** Storage directory */
  storageDir: string;
  /** Trigger reflection every N sessions */
  reflectionInterval: number;
  /** Minimum sessions before first reflection */
  minSessionsBeforeReflection: number;
}

// ─── Default User Model ──────────────────────────────────────────

export function createDefaultUserModel(userId: string): UserModel {
  return {
    userId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionCount: 0,
    preferences: {
      languages: [],
      codeStyle: "documented",
      testing: "after",
      imports: "auto",
    },
    stack: {
      frameworks: [],
      buildTools: [],
      packageManagers: [],
      databases: [],
      cloudProviders: [],
    },
    communication: {
      detailLevel: "moderate",
      likesExamples: true,
      codeFirst: false,
      format: "markdown",
    },
    goals: {
      learning: [],
      interests: [],
      painPoints: [],
    },
    insights: [],
  };
}

// ─── UserModelManager ────────────────────────────────────────────

export class UserModelManager {
  private options: Required<UserModelOptions>;
  private modelCache: Map<string, UserModel> = new Map();

  constructor(options: Partial<UserModelOptions> = {}) {
    this.options = {
      storageDir: options.storageDir ?? ".rookie/user-models",
      reflectionInterval: options.reflectionInterval ?? 20,
      minSessionsBeforeReflection: options.minSessionsBeforeReflection ?? 5,
    };
  }

  /**
   * Get or create user model for a user.
   */
  async getModel(userId: string): Promise<UserModel> {
    // Check cache first
    const cached = this.modelCache.get(userId);
    if (cached) return cached;

    // Try to load from disk
    const model = await this.loadModel(userId);
    this.modelCache.set(userId, model);
    return model;
  }

  /**
   * Save user model.
   */
  async saveModel(model: UserModel): Promise<void> {
    model.updatedAt = new Date().toISOString();
    this.modelCache.set(model.userId, model);

    const filepath = this.getModelPath(model.userId);
    await mkdir(path.dirname(filepath), { recursive: true });
    await writeFile(filepath, JSON.stringify(model, null, 2), "utf-8");
  }

  /**
   * Record a new session and check if reflection should trigger.
   */
  async recordSession(userId: string, _messages: Message[]): Promise<{
    model: UserModel;
    shouldReflect: boolean;
  }> {
    const model = await this.getModel(userId);
    model.sessionCount++;
    await this.saveModel(model);

    const shouldReflect =
      model.sessionCount >= this.options.minSessionsBeforeReflection &&
      model.sessionCount % this.options.reflectionInterval === 0;

    return { model, shouldReflect };
  }

  /**
   * Update user model with Reflector output.
   */
  async applyReflectorOutput(
    userId: string,
    output: ReflectorOutput
  ): Promise<UserModel> {
    const model = await this.getModel(userId);

    // Apply updates
    if (output.updates.preferences) {
      model.preferences = { ...model.preferences, ...output.updates.preferences };
    }
    if (output.updates.stack) {
      model.stack = { ...model.stack, ...output.updates.stack };
    }
    if (output.updates.communication) {
      model.communication = { ...model.communication, ...output.updates.communication };
    }
    if (output.updates.goals) {
      model.goals = { ...model.goals, ...output.updates.goals };
    }

    // Add new insights
    model.insights.push(...output.newInsights);

    // Keep only last 50 insights
    if (model.insights.length > 50) {
      model.insights = model.insights.slice(-50);
    }

    await this.saveModel(model);
    return model;
  }

  /**
   * Get model as context string for prompting.
   */
  getModelAsContext(model: UserModel): string {
    const parts: string[] = ["## User Profile"];

    // Preferences
    parts.push("\n### Preferences");
    parts.push(`- Languages: ${model.preferences.languages.join(", ") || "not specified"}`);
    parts.push(`- Code style: ${model.preferences.codeStyle}`);
    parts.push(`- Testing: ${model.preferences.testing}`);
    parts.push(`- Imports: ${model.preferences.imports}`);

    // Stack
    if (model.stack.frameworks.length > 0 || model.stack.buildTools.length > 0) {
      parts.push("\n### Tech Stack");
      if (model.stack.frameworks.length) {
        parts.push(`- Frameworks: ${model.stack.frameworks.join(", ")}`);
      }
      if (model.stack.buildTools.length) {
        parts.push(`- Build tools: ${model.stack.buildTools.join(", ")}`);
      }
      if (model.stack.databases.length) {
        parts.push(`- Databases: ${model.stack.databases.join(", ")}`);
      }
    }

    // Communication
    parts.push("\n### Communication Style");
    parts.push(`- Detail level: ${model.communication.detailLevel}`);
    parts.push(`- Code first: ${model.communication.codeFirst ? "yes" : "no"}`);
    parts.push(`- Likes examples: ${model.communication.likesExamples ? "yes" : "no"}`);

    // Goals
    if (model.goals.learning.length > 0 || model.goals.interests.length > 0) {
      parts.push("\n### Goals & Interests");
      if (model.goals.learning.length) {
        parts.push(`- Learning: ${model.goals.learning.join(", ")}`);
      }
      if (model.goals.interests.length) {
        parts.push(`- Interests: ${model.goals.interests.join(", ")}`);
      }
    }

    // Recent insights
    if (model.insights.length > 0) {
      parts.push("\n### Key Insights");
      model.insights.slice(-5).forEach((insight) => {
        parts.push(`- ${insight}`);
      });
    }

    return parts.join("\n");
  }

  /**
   * Merge user model context into system prompt.
   */
  mergeIntoSystemPrompt(systemPrompt: string, model: UserModel): string {
    const context = this.getModelAsContext(model);
    return `${systemPrompt}\n\n${context}`;
  }

  // ─── Private helpers ────────────────────────────────────────

  private async loadModel(userId: string): Promise<UserModel> {
    const filepath = this.getModelPath(userId);
    try {
      const content = await readFile(filepath, "utf-8");
      return JSON.parse(content) as UserModel;
    } catch {
      return createDefaultUserModel(userId);
    }
  }

  private getModelPath(userId: string): string {
    // Use hash of userId for filename to avoid special characters
    const hash = Buffer.from(userId).toString("base64url");
    return path.join(this.options.storageDir, `${hash}.json`);
  }
}

// ─── Reflector Agent ─────────────────────────────────────────────

export interface ReflectorAgent {
  run(input: ReflectorInput): Promise<ReflectorOutput>;
}

/**
 * Simple rule-based Reflector for MVP.
 * In production, this would be an LLM-based agent.
 */
export class SimpleReflector implements ReflectorAgent {
  async run(input: ReflectorInput): Promise<ReflectorOutput> {
    const updates: ReflectorOutput["updates"] = {};
    const newInsights: string[] = [];

    // Analyze messages for patterns
    const allMessages = input.recentSessions.flat();
    const userMessages = allMessages.filter((m) => m.role === "user");
    const content = userMessages.map((m) => m.content).join("\n").toLowerCase();

    // Detect languages
    const languages = this.detectLanguages(content);
    if (languages.length > 0) {
      updates.preferences = { languages } as UserPreferences;
    }

    // Detect frameworks
    const frameworks = this.detectFrameworks(content);
    if (frameworks.length > 0) {
      updates.stack = { frameworks } as TechStack;
    }

    // Detect communication style
    const communication = this.detectCommunicationStyle(userMessages);
    if (communication) {
      updates.communication = communication;
    }

    // Generate insights
    if (content.includes("test") || content.includes("spec")) {
      newInsights.push("User frequently asks about testing");
    }
    if (content.includes("performance") || content.includes("optimize")) {
      newInsights.push("User cares about performance optimization");
    }
    if (content.includes("refactor") || content.includes("clean")) {
      newInsights.push("User values code quality and refactoring");
    }

    return {
      updates,
      newInsights,
      confidence: 0.7,
    };
  }

  private detectLanguages(content: string): string[] {
    const languages: string[] = [];
    const patterns: Record<string, RegExp> = {
      typescript: /\btypescript\b|\bts\b.*node/,
      javascript: /\bjavascript\b|\bjs\b(?!on)/,
      python: /\bpython\b|\bpy\b/,
      rust: /\brust\b|\bcargo\b/,
      go: /\bgolang\b|\bgo\b.*module/,
      java: /\bjava\b(?!script)/,
      "c++": /\bc\+\+\b/,
      c: /\bc\b.*program/,
    };

    for (const [lang, pattern] of Object.entries(patterns)) {
      if (pattern.test(content)) {
        languages.push(lang);
      }
    }

    return languages;
  }

  private detectFrameworks(content: string): string[] {
    const frameworks: string[] = [];
    const patterns: Record<string, RegExp> = {
      react: /\breact\b/,
      vue: /\bvue\b/,
      angular: /\bangular\b/,
      svelte: /\bsvelte\b/,
      express: /\bexpress\b/,
      fastify: /\bfastify\b/,
      nestjs: /\bnest\b|\bnestjs\b/,
      django: /\bdjango\b/,
      flask: /\bflask\b/,
      spring: /\bspring\b.*boot/,
    };

    for (const [fw, pattern] of Object.entries(patterns)) {
      if (pattern.test(content)) {
        frameworks.push(fw);
      }
    }

    return frameworks;
  }

  private detectCommunicationStyle(messages: Message[]): CommunicationStyle | null {
    if (messages.length === 0) return null;

    // Check message length for detail level
    const avgLength = messages.reduce((sum, m) => sum + m.content.length, 0) / messages.length;

    let detailLevel: CommunicationStyle["detailLevel"] = "moderate";
    if (avgLength < 50) {
      detailLevel = "brief";
    } else if (avgLength > 200) {
      detailLevel = "detailed";
    }

    // Check if user asks for examples
    const asksForExamples = messages.some(
      (m) =>
        m.content.includes("example") ||
        m.content.includes("sample") ||
        m.content.includes("demo")
    );

    // Check if user prefers code
    const codeFirst = messages.some(
      (m) =>
        m.content.includes("just code") ||
        m.content.includes("show me the code") ||
        m.content.includes("code only")
    );

    return {
      detailLevel,
      likesExamples: asksForExamples,
      codeFirst,
      format: "markdown",
    };
  }
}
