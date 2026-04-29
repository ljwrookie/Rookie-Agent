/**
 * LLM-based Dialectical Reflector for User Modeling (P8-T2)
 * 
 * Implements Hegelian dialectic:
 * - Thesis: Extract user feature hypotheses from sessions
 * - Antithesis: Find counter-evidence to challenge assumptions
 * - Synthesis: Combine thesis and antithesis for accurate model
 */

import { Message } from "../agent/types.js";
import {
  UserModel,
  UserPreferences,
  TechStack,
  CommunicationStyle,
  UserGoals,
  ReflectorInput,
  ReflectorOutput,
  ReflectorAgent,
  SimpleReflector,
} from "./user-model.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface DialecticalAnalysis {
  /** Hypothesis extracted from sessions (Thesis) */
  thesis: UserHypothesis;
  /** Counter-evidence challenging the hypothesis (Antithesis) */
  antithesis: CounterEvidence;
  /** Synthesized conclusion */
  synthesis: SynthesisResult;
}

export interface UserHypothesis {
  inferredPreferences: Partial<UserPreferences>;
  inferredStack: Partial<TechStack>;
  inferredCommunication: Partial<CommunicationStyle>;
  inferredGoals: Partial<UserGoals>;
  confidence: number;
  reasoning: string[];
}

export interface CounterEvidence {
  contradictions: Contradiction[];
  missingEvidence: string[];
  alternativeInterpretations: string[];
  confidenceReduction: number;
}

export interface Contradiction {
  field: string;
  assumed: string;
  observed: string;
  severity: "low" | "medium" | "high";
}

export interface SynthesisResult {
  finalPreferences: Partial<UserPreferences>;
  finalStack: Partial<TechStack>;
  finalCommunication: Partial<CommunicationStyle>;
  finalGoals: Partial<UserGoals>;
  confidence: number;
  insights: string[];
  uncertaintyAreas: string[];
}

export interface LLMReflectorConfig {
  /** LLM provider/model to use for reflection */
  model?: string;
  /** Temperature for generation */
  temperature?: number;
  /** Maximum tokens per reflection */
  maxTokens?: number;
  /** Enable dialectical analysis (thesis-antithesis-synthesis) */
  enableDialectic?: boolean;
  /** Number of sessions to analyze in one batch */
  batchSize?: number;
  /** Minimum confidence threshold for updates */
  minConfidenceThreshold?: number;
}

// ─── LLM Reflector ─────────────────────────────────────────────────

export class LLMReflector implements ReflectorAgent {
  private config: Required<LLMReflectorConfig>;

  constructor(config: LLMReflectorConfig = {}) {
    this.config = {
      model: config.model ?? "claude-sonnet-4-20250514",
      temperature: config.temperature ?? 0.3,
      maxTokens: config.maxTokens ?? 4000,
      enableDialectic: config.enableDialectic ?? true,
      batchSize: config.batchSize ?? 5,
      minConfidenceThreshold: config.minConfidenceThreshold ?? 0.6,
    };
  }

  async run(input: ReflectorInput): Promise<ReflectorOutput> {
    if (this.config.enableDialectic) {
      return this.runDialecticalReflection(input);
    }
    return this.runSimpleReflection(input);
  }

  /**
   * Run full dialectical analysis (Thesis → Antithesis → Synthesis)
   */
  private async runDialecticalReflection(input: ReflectorInput): Promise<ReflectorOutput> {
    // Phase 1: Thesis - Extract hypotheses
    const thesis = await this.extractThesis(input);
    
    // Phase 2: Antithesis - Find counter-evidence
    const antithesis = await this.extractAntithesis(input, thesis);
    
    // Phase 3: Synthesis - Combine and resolve
    const synthesis = await this.synthesize(input, thesis, antithesis);

    // Convert synthesis to ReflectorOutput format
    return {
      updates: {
        preferences: Object.keys(synthesis.finalPreferences).length > 0 
          ? synthesis.finalPreferences as UserPreferences 
          : undefined,
        stack: Object.keys(synthesis.finalStack).length > 0 
          ? synthesis.finalStack as TechStack 
          : undefined,
        communication: Object.keys(synthesis.finalCommunication).length > 0 
          ? synthesis.finalCommunication as CommunicationStyle 
          : undefined,
        goals: Object.keys(synthesis.finalGoals).length > 0 
          ? synthesis.finalGoals as UserGoals 
          : undefined,
      },
      newInsights: synthesis.insights,
      confidence: synthesis.confidence,
    };
  }

  /**
   * Phase 1: Thesis - Extract user feature hypotheses
   */
  private async extractThesis(input: ReflectorInput): Promise<UserHypothesis> {
    const sessionsText = this.formatSessions(input.recentSessions);
    const currentModel = input.currentModel 
      ? this.formatCurrentModel(input.currentModel) 
      : "No existing user model.";

    const prompt = `You are a user modeling expert. Analyze the following conversation sessions and extract hypotheses about the user's preferences, tech stack, communication style, and goals.

## Current User Model
${currentModel}

## Recent Sessions
${sessionsText}

## Task
Extract hypotheses about:
1. **Preferences**: Languages, code style, testing approach, import style
2. **Tech Stack**: Frameworks, build tools, package managers, databases, cloud providers
3. **Communication Style**: Detail level, likes examples, code-first preference, format
4. **Goals**: Current project, learning goals, interests, pain points

For each hypothesis, provide:
- The inferred value
- Confidence level (0.0-1.0)
- Reasoning based on evidence from sessions

Format your response as JSON:
\`\`\`json
{
  "inferredPreferences": { /* partial UserPreferences */ },
  "inferredStack": { /* partial TechStack */ },
  "inferredCommunication": { /* partial CommunicationStyle */ },
  "inferredGoals": { /* partial UserGoals */ },
  "confidence": 0.8,
  "reasoning": ["Evidence 1", "Evidence 2"]
}
\`\`\``;

    void prompt;

    // In a real implementation, this would call an LLM
    // For now, we simulate the response
    return this.simulateThesisExtraction(input);
  }

  /**
   * Phase 2: Antithesis - Find counter-evidence and contradictions
   */
  private async extractAntithesis(
    input: ReflectorInput, 
    thesis: UserHypothesis
  ): Promise<CounterEvidence> {
    const sessionsText = this.formatSessions(input.recentSessions);
    const thesisText = JSON.stringify(thesis, null, 2);

    const prompt = `You are a critical analyst. Review the following hypothesis about a user and find evidence that CONTRADICTS or CHALLENGES it.

## Hypothesis (Thesis)
${thesisText}

## Raw Session Data
${sessionsText}

## Task
Find:
1. **Contradictions**: Places where the user's behavior contradicts the hypothesis
2. **Missing Evidence**: What the hypothesis assumes but isn't clearly supported
3. **Alternative Interpretations**: Other ways to interpret the same behavior
4. **Confidence Reduction**: How much to reduce confidence based on counter-evidence

Format your response as JSON:
\`\`\`json
{
  "contradictions": [
    {"field": "preferences.codeStyle", "assumed": "concise", "observed": "verbose with comments", "severity": "medium"}
  ],
  "missingEvidence": ["No evidence of React usage in last 5 sessions"],
  "alternativeInterpretations": ["User might be learning, not preferring TypeScript"],
  "confidenceReduction": 0.2
}
\`\`\``;

    void prompt;

    return this.simulateAntithesisExtraction(input, thesis);
  }

  /**
   * Phase 3: Synthesis - Combine thesis and antithesis
   */
  private async synthesize(
    input: ReflectorInput,
    thesis: UserHypothesis,
    antithesis: CounterEvidence
  ): Promise<SynthesisResult> {
    const prompt = `You are a synthesis expert. Combine the following thesis and antithesis to produce a balanced, accurate user model.

## Thesis (Initial Hypothesis)
Confidence: ${thesis.confidence}
${JSON.stringify(thesis, null, 2)}

## Antithesis (Counter-Evidence)
Confidence Reduction: ${antithesis.confidenceReduction}
${JSON.stringify(antithesis, null, 2)}

## Task
Produce a synthesis that:
1. Resolves contradictions (favor direct evidence over inference)
2. Acknowledges uncertainty where evidence is weak
3. Updates confidence based on quality of evidence
4. Identifies areas needing more data

Format your response as JSON:
\`\`\`json
{
  "finalPreferences": { /* resolved preferences */ },
  "finalStack": { /* resolved tech stack */ },
  "finalCommunication": { /* resolved communication style */ },
  "finalGoals": { /* resolved goals */ },
  "confidence": 0.7,
  "insights": ["New insight 1", "New insight 2"],
  "uncertaintyAreas": ["Need more data on testing preferences"]
}
\`\`\``;

    void prompt;

    return this.simulateSynthesis(input, thesis, antithesis);
  }

  /**
   * Simple reflection without dialectic (fallback)
   */
  private async runSimpleReflection(input: ReflectorInput): Promise<ReflectorOutput> {
    const thesis = await this.extractThesis(input);
    
    return {
      updates: {
        preferences: Object.keys(thesis.inferredPreferences).length > 0 
          ? thesis.inferredPreferences as UserPreferences 
          : undefined,
        stack: Object.keys(thesis.inferredStack).length > 0 
          ? thesis.inferredStack as TechStack 
          : undefined,
        communication: Object.keys(thesis.inferredCommunication).length > 0 
          ? thesis.inferredCommunication as CommunicationStyle 
          : undefined,
        goals: Object.keys(thesis.inferredGoals).length > 0 
          ? thesis.inferredGoals as UserGoals 
          : undefined,
      },
      newInsights: thesis.reasoning,
      confidence: thesis.confidence,
    };
  }

  // ─── Simulation Methods (would be LLM calls in production) ─────────

  private simulateThesisExtraction(input: ReflectorInput): UserHypothesis {
    const allMessages = input.recentSessions.flat();
    const userMessages = allMessages.filter(m => m.role === "user");
    const content = userMessages.map(m => m.content).join("\n").toLowerCase();

    // Advanced pattern detection (beyond SimpleReflector)
    const inferredPreferences: Partial<UserPreferences> = {};
    const inferredStack: Partial<TechStack> = {};
    const inferredCommunication: Partial<CommunicationStyle> = {};
    const inferredGoals: Partial<UserGoals> = {};
    const reasoning: string[] = [];

    // Detect nuanced preferences
    if (/\bquickly\b|\basap\b|\bspeed\b/.test(content)) {
      inferredPreferences.codeStyle = "concise";
      reasoning.push("User frequently emphasizes speed and quickness");
    }

    if (/\bdocumentation\b|\bdoc\b|\bcomment\b/.test(content)) {
      inferredPreferences.codeStyle = "documented";
      reasoning.push("User asks for documentation and comments");
    }

    const languages: string[] = [];
    if (/\btypescript\b|\bts\b.*node/.test(content)) languages.push("typescript");
    if (/\bjavascript\b|\bjs\b(?!on)/.test(content)) languages.push("javascript");
    if (/\bpython\b|\bpy\b/.test(content)) languages.push("python");
    if (/\brust\b|\bcargo\b/.test(content)) languages.push("rust");
    if (/\bgolang\b|\bgo\b.*module/.test(content)) languages.push("go");
    if (/\bjava\b(?!script)/.test(content)) languages.push("java");
    if (languages.length > 0) {
      inferredPreferences.languages = languages;
      reasoning.push(`User explicitly references languages: ${languages.join(", ")}`);
    }

    if (content.includes("test") || content.includes("spec")) {
      reasoning.push("User frequently asks about testing");
    }

    // Detect tech stack with more context
    const frameworks: string[] = [];
    if (/\breact\b|\bhooks?\b|\buseeffect\b|\busestate\b/.test(content)) {
      frameworks.push("react");
      reasoning.push("User mentions React hooks specifically");
    }
    if (/\bvue\b.*\bcomposition\b|\bcomposable\b/.test(content)) {
      frameworks.push("vue3");
      reasoning.push("User uses Vue Composition API");
    }
    if (frameworks.length > 0) {
      inferredStack.frameworks = frameworks;
    }

    // Detect learning goals
    const learning: string[] = [];
    if (/\blearn\b|\blearning\b|\bstudy\b/.test(content)) {
      if (/\brust\b/.test(content)) learning.push("rust");
      if (/\bgo\b|\bgolang\b/.test(content)) learning.push("go");
      if (/\btypescript\b/.test(content)) learning.push("typescript");
    }
    if (learning.length > 0) {
      inferredGoals.learning = learning;
      reasoning.push(`User expressed interest in learning: ${learning.join(", ")}`);
    }

    // Detect pain points
    const painPoints: string[] = [];
    if (/\bfrustrat\b|\bangry\b|\bannoy\b|\bsick of\b/.test(content)) {
      if (/\bbug\b|\berror\b/.test(content)) painPoints.push("debugging frustration");
      if (/\bslow\b|\blag\b/.test(content)) painPoints.push("performance issues");
    }
    if (painPoints.length > 0) {
      inferredGoals.painPoints = painPoints;
    }

    // Communication style detection
    const avgLength = userMessages.reduce((sum, m) => sum + m.content.length, 0) / (userMessages.length || 1);
    if (avgLength < 30) {
      inferredCommunication.detailLevel = "brief";
      reasoning.push("User uses very short messages");
    } else if (avgLength > 300) {
      inferredCommunication.detailLevel = "detailed";
      reasoning.push("User provides detailed context");
    }

    // Check for implicit preferences (things user doesn't say but implies)
    if (/\bjust\b|\bonly\b|\bsimply\b/.test(content)) {
      inferredCommunication.codeFirst = true;
      reasoning.push("User uses minimizing words suggesting code preference");
    }

    const confidence = Math.min(0.5 + reasoning.length * 0.1, 0.9);

    return {
      inferredPreferences,
      inferredStack,
      inferredCommunication,
      inferredGoals,
      confidence,
      reasoning,
    };
  }

  private simulateAntithesisExtraction(
    input: ReflectorInput,
    thesis: UserHypothesis
  ): CounterEvidence {
    const contradictions: Contradiction[] = [];
    const missingEvidence: string[] = [];
    const alternativeInterpretations: string[] = [];

    const allMessages = input.recentSessions.flat();
    const userMessages = allMessages.filter(m => m.role === "user");
    const content = userMessages.map(m => m.content).join("\n").toLowerCase();

    // Look for contradictions to thesis
    if (thesis.inferredPreferences?.codeStyle === "concise") {
      if (/\bexplain\b|\bwhy\b|\bhow does\b/.test(content)) {
        contradictions.push({
          field: "preferences.codeStyle",
          assumed: "concise (wants minimal code)",
          observed: "asks for explanations",
          severity: "medium",
        });
      }
    }

    if (thesis.inferredCommunication?.codeFirst) {
      if (/\bexplain\b|\btell me\b|\bwhat is\b/.test(content)) {
        contradictions.push({
          field: "communication.codeFirst",
          assumed: "prefers code over explanation",
          observed: "frequently asks for explanations",
          severity: "high",
        });
      }
    }

    // Identify missing evidence
    if (!thesis.inferredStack?.frameworks || thesis.inferredStack.frameworks.length === 0) {
      missingEvidence.push("No clear evidence of framework preferences in recent sessions");
    }

    if (!content.includes("test") && !content.includes("spec")) {
      missingEvidence.push("Insufficient data to determine testing preferences");
    }

    // Alternative interpretations
    if (thesis.inferredGoals?.learning?.includes("rust")) {
      alternativeInterpretations.push(
        "User might be evaluating Rust for work, not personal learning"
      );
    }

    if (thesis.inferredPreferences?.codeStyle === "documented") {
      alternativeInterpretations.push(
        "User might be working on a team project requiring documentation, not personal preference"
      );
    }

    // Calculate confidence reduction based on contradictions
    const severityWeights = { low: 0.05, medium: 0.1, high: 0.2 };
    const confidenceReduction = contradictions.reduce(
      (sum, c) => sum + severityWeights[c.severity],
      0
    );

    return {
      contradictions,
      missingEvidence,
      alternativeInterpretations,
      confidenceReduction: Math.min(confidenceReduction, 0.5),
    };
  }

  private simulateSynthesis(
    input: ReflectorInput,
    thesis: UserHypothesis,
    antithesis: CounterEvidence
  ): SynthesisResult {
    // Start with thesis values
    const finalPreferences = { ...thesis.inferredPreferences };
    const finalStack = { ...thesis.inferredStack };
    const finalCommunication = { ...thesis.inferredCommunication };
    const finalGoals = { ...thesis.inferredGoals };
    const insights: string[] = [];
    const uncertaintyAreas: string[] = [];

    // Apply antithesis corrections
    for (const contradiction of antithesis.contradictions) {
      if (contradiction.severity === "high") {
        // Remove or modify the contradicted field
        const field = contradiction.field.split(".")[1];
        if (field && field in finalPreferences) {
          delete (finalPreferences as Record<string, unknown>)[field];
        }
        insights.push(`Corrected ${contradiction.field} based on counter-evidence`);
      }
    }

    // Add insights from reasoning
    insights.push(...thesis.reasoning.slice(0, 3));

    // Add uncertainty areas
    uncertaintyAreas.push(...antithesis.missingEvidence);

    // Consider alternative interpretations
    if (antithesis.alternativeInterpretations.length > 0) {
      uncertaintyAreas.push(
        `Alternative interpretation: ${antithesis.alternativeInterpretations[0]}`
      );
    }

    // Calculate final confidence
    const baseConfidence = thesis.confidence;
    const adjustedConfidence = Math.max(
      0.3,
      baseConfidence - antithesis.confidenceReduction
    );

    // Add synthesis-specific insights that SimpleReflector would miss
    const allMessages = input.recentSessions.flat();
    const userMessages = allMessages.filter(m => m.role === "user");
    const content = userMessages.map(m => m.content).join("\n").toLowerCase();

    // Detect implicit patterns SimpleReflector misses
    if (/\bcan you\b|\bcould you\b|\bwould you\b/.test(content)) {
      const politeRequests = (content.match(/\bcan you\b|\bcould you\b|\bwould you\b/g) || []).length;
      if (politeRequests > userMessages.length * 0.5) {
        insights.push("User consistently uses polite request form - prefers collaborative tone");
      }
    }

    // Detect frustration patterns
    const frustrationPatterns = /\bugh\b|\bargh\b|\bseriously\?\b|\bnot again\b|\bwhy does\b.*\balways\b/i;
    if (frustrationPatterns.test(content)) {
      insights.push("User shows signs of recurring frustration - may benefit from proactive problem prevention");
    }

    // Detect implicit learning style
    if (/\bstep by step\b|\bbreak it down\b|\bhow would you\b/.test(content)) {
      insights.push("User prefers step-by-step guidance - may be a sequential learner");
      finalCommunication.detailLevel = "detailed";
    }

    return {
      finalPreferences,
      finalStack,
      finalCommunication,
      finalGoals,
      confidence: adjustedConfidence,
      insights,
      uncertaintyAreas,
    };
  }

  // ─── Helper Methods ────────────────────────────────────────────────

  private formatSessions(sessions: Message[][]): string {
    return sessions
      .map((session, idx) => {
        const messages = session
          .map(m => `[${m.role}]: ${m.content.slice(0, 200)}${m.content.length > 200 ? "..." : ""}`)
          .join("\n");
        return `### Session ${idx + 1}\n${messages}`;
      })
      .join("\n\n");
  }

  private formatCurrentModel(model: UserModel): string {
    return JSON.stringify(
      {
        preferences: model.preferences,
        stack: model.stack,
        communication: model.communication,
        goals: model.goals,
        insights: model.insights.slice(-5),
      },
      null,
      2
    );
  }
}

// ─── Reflector Factory ─────────────────────────────────────────────

export type ReflectorType = "simple" | "llm" | "llm-dialectical";

export interface ReflectorFactoryConfig {
  type: ReflectorType;
  llmConfig?: LLMReflectorConfig;
}

export class ReflectorFactory {
  static create(config: ReflectorFactoryConfig): ReflectorAgent {
    switch (config.type) {
      case "simple":
        return new SimpleReflector();
      
      case "llm":
        return new LLMReflector({ ...config.llmConfig, enableDialectic: false });
      
      case "llm-dialectical":
        return new LLMReflector({ ...config.llmConfig, enableDialectic: true });
      
      default:
        throw new Error(`Unknown reflector type: ${config.type}`);
    }
  }

  /**
   * Get the best reflector for the given session count
   */
  static createForSessionCount(sessionCount: number): ReflectorAgent {
    if (sessionCount < 5) {
      // Not enough data for LLM analysis
      return new SimpleReflector();
    } else if (sessionCount < 20) {
      // Use LLM without full dialectic for efficiency
      return new LLMReflector({ enableDialectic: false });
    } else {
      // Full dialectical analysis for rich user models
      return new LLMReflector({ enableDialectic: true });
    }
  }
}

// ─── Incremental Update Manager ────────────────────────────────────

export interface IncrementalUpdate {
  timestamp: number;
  updates: ReflectorOutput;
  sessionsAnalyzed: number;
  previousConfidence: number;
  newConfidence: number;
}

export class IncrementalReflector {
  private updates: IncrementalUpdate[] = [];
  private maxUpdates: number;

  constructor(maxUpdates: number = 50) {
    this.maxUpdates = maxUpdates;
  }

  /**
   * Apply an incremental update
   */
  recordUpdate(update: IncrementalUpdate): void {
    this.updates.push(update);
    
    // Keep only recent updates
    if (this.updates.length > this.maxUpdates) {
      this.updates = this.updates.slice(-this.maxUpdates);
    }
  }

  /**
   * Get update history
   */
  getHistory(): IncrementalUpdate[] {
    return [...this.updates];
  }

  /**
   * Calculate confidence trend
   */
  getConfidenceTrend(): "improving" | "stable" | "declining" | "unknown" {
    if (this.updates.length < 3) return "unknown";
    
    const recent = this.updates.slice(-5);
    const deltas = recent.map(u => u.newConfidence - u.previousConfidence);
    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    
    if (avgDelta > 0.05) return "improving";
    if (avgDelta < -0.05) return "declining";
    return "stable";
  }

  /**
   * Get fields that have changed most frequently
   */
  getMostChangedFields(): Array<{ field: string; changeCount: number }> {
    const fieldCounts = new Map<string, number>();
    
    for (const update of this.updates) {
      const fields = Object.keys(update.updates.updates);
      for (const field of fields) {
        fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
      }
    }
    
    return Array.from(fieldCounts.entries())
      .map(([field, changeCount]) => ({ field, changeCount }))
      .sort((a, b) => b.changeCount - a.changeCount);
  }
}
