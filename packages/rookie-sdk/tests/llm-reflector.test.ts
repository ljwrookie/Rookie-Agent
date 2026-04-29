/**
 * LLM Reflector Tests (P8-T2)
 */

import { describe, it, expect } from "vitest";
import {
  LLMReflector,
  ReflectorFactory,
  IncrementalReflector,
} from "../src/memory/llm-reflector.js";
import { SimpleReflector } from "../src/memory/user-model.js";
import { Message } from "../src/agent/types.js";

describe("LLMReflector", () => {
  const createMockSessions = (): Message[][] => [
    [
      { role: "user", content: "Help me write TypeScript code" },
      { role: "assistant", content: "Sure, here's a TypeScript example..." },
    ],
    [
      { role: "user", content: "I need to refactor this React component" },
      { role: "assistant", content: "Here's how to refactor it..." },
    ],
    [
      { role: "user", content: "Can you show me an example of using hooks?" },
      { role: "assistant", content: "Here's a useEffect example..." },
    ],
  ];

  describe("basic operation", () => {
    it("should create LLMReflector with default config", () => {
      const reflector = new LLMReflector();
      expect(reflector).toBeDefined();
    });

    it("should create LLMReflector with custom config", () => {
      const reflector = new LLMReflector({
        model: "custom-model",
        temperature: 0.5,
        enableDialectic: true,
      });
      expect(reflector).toBeDefined();
    });

    it("should run reflection and return output", async () => {
      const reflector = new LLMReflector();
      const sessions = createMockSessions();

      const result = await reflector.run({
        recentSessions: sessions,
        sessionCount: 3,
      });

      expect(result).toBeDefined();
      expect(result.updates).toBeDefined();
      expect(result.newInsights).toBeDefined();
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("dialectical analysis", () => {
    it("should perform thesis extraction", async () => {
      const reflector = new LLMReflector({ enableDialectic: true });
      const sessions = createMockSessions();

      const result = await reflector.run({
        recentSessions: sessions,
        sessionCount: 3,
      });

      // Should detect TypeScript and React from sessions
      expect(result.updates.stack?.frameworks).toContain("react");
      expect(result.updates.preferences?.languages).toContain("typescript");
    });

    it("should detect communication style", async () => {
      const reflector = new LLMReflector();
      const sessions: Message[][] = [
        [
          { role: "user", content: "just code" },
          { role: "assistant", content: "Here:" },
        ],
        [
          { role: "user", content: "show me the code" },
          { role: "assistant", content: "Code:" },
        ],
      ];

      const result = await reflector.run({
        recentSessions: sessions,
        sessionCount: 2,
      });

      expect(result.updates.communication?.codeFirst).toBe(true);
    });

    it("should detect learning goals", async () => {
      const reflector = new LLMReflector();
      const sessions: Message[][] = [
        [
          { role: "user", content: "I'm learning Rust and want to understand ownership" },
          { role: "assistant", content: "Ownership in Rust..." },
        ],
      ];

      const result = await reflector.run({
        recentSessions: sessions,
        sessionCount: 1,
      });

      expect(result.updates.goals?.learning).toContain("rust");
    });
  });

  describe("insights generation", () => {
    it("should generate insights about user preferences", async () => {
      const reflector = new LLMReflector();
      const sessions: Message[][] = [
        [
          { role: "user", content: "How do I test this function?" },
          { role: "assistant", content: "You can use Jest..." },
        ],
        [
          { role: "user", content: "Write a test for this component" },
          { role: "assistant", content: "Here's a test..." },
        ],
      ];

      const result = await reflector.run({
        recentSessions: sessions,
        sessionCount: 2,
      });

      const testingInsight = result.newInsights.find(i => 
        i.toLowerCase().includes("test")
      );
      expect(testingInsight).toBeDefined();
    });

    it("should detect frustration patterns", async () => {
      const reflector = new LLMReflector();
      const sessions: Message[][] = [
        [
          { role: "user", content: "Ugh, this bug keeps happening!" },
          { role: "assistant", content: "Let's fix it..." },
        ],
      ];

      const result = await reflector.run({
        recentSessions: sessions,
        sessionCount: 1,
      });

      const frustrationInsight = result.newInsights.find(i =>
        i.toLowerCase().includes("frustrat")
      );
      expect(frustrationInsight).toBeDefined();
    });
  });

  describe("comparison with SimpleReflector", () => {
    it("should detect more nuanced patterns than SimpleReflector", async () => {
      const simpleReflector = new SimpleReflector();
      const llmReflector = new LLMReflector();

      // Sessions with implicit preferences
      const sessions: Message[][] = [
        [
          { role: "user", content: "Can you please help me understand this step by step?" },
          { role: "assistant", content: "Sure, first..." },
        ],
        [
          { role: "user", content: "Could you break it down for me?" },
          { role: "assistant", content: "Of course..." },
        ],
      ];

      const simpleResult = await simpleReflector.run({
        recentSessions: sessions,
        sessionCount: 2,
      });

      const llmResult = await llmReflector.run({
        recentSessions: sessions,
        sessionCount: 2,
      });

      // LLM reflector should detect the sequential learning pattern
      const hasSequentialLearning = llmResult.newInsights.some(i =>
        i.toLowerCase().includes("step") || 
        i.toLowerCase().includes("sequential")
      );

      // Simple reflector might miss this
      expect(hasSequentialLearning).toBe(true);
    });

    it("should detect polite collaborative tone", async () => {
      const llmReflector = new LLMReflector();

      const sessions: Message[][] = [
        [
          { role: "user", content: "Can you help me with this?" },
          { role: "assistant", content: "Yes..." },
        ],
        [
          { role: "user", content: "Would you mind showing me an example?" },
          { role: "assistant", content: "Sure..." },
        ],
        [
          { role: "user", content: "Could you explain how this works?" },
          { role: "assistant", content: "Certainly..." },
        ],
      ];

      const result = await llmReflector.run({
        recentSessions: sessions,
        sessionCount: 3,
      });

      const collaborativeInsight = result.newInsights.find(i =>
        i.toLowerCase().includes("polite") ||
        i.toLowerCase().includes("collaborative")
      );

      expect(collaborativeInsight).toBeDefined();
    });
  });
});

describe("ReflectorFactory", () => {
  it("should create simple reflector", () => {
    const reflector = ReflectorFactory.create({ type: "simple" });
    expect(reflector).toBeInstanceOf(SimpleReflector);
  });

  it("should create LLM reflector", () => {
    const reflector = ReflectorFactory.create({ type: "llm" });
    expect(reflector).toBeInstanceOf(LLMReflector);
  });

  it("should create dialectical LLM reflector", () => {
    const reflector = ReflectorFactory.create({ type: "llm-dialectical" });
    expect(reflector).toBeInstanceOf(LLMReflector);
  });

  it("should throw for unknown type", () => {
    expect(() => {
      ReflectorFactory.create({ type: "unknown" as any });
    }).toThrow("Unknown reflector type");
  });

  it("should create appropriate reflector for session count", () => {
    const fewSessions = ReflectorFactory.createForSessionCount(3);
    expect(fewSessions).toBeInstanceOf(SimpleReflector);

    const mediumSessions = ReflectorFactory.createForSessionCount(10);
    expect(mediumSessions).toBeInstanceOf(LLMReflector);

    const manySessions = ReflectorFactory.createForSessionCount(25);
    expect(manySessions).toBeInstanceOf(LLMReflector);
  });
});

describe("IncrementalReflector", () => {
  it("should record updates", () => {
    const tracker = new IncrementalReflector();
    
    tracker.recordUpdate({
      timestamp: Date.now(),
      updates: {
        updates: { preferences: { languages: ["typescript"] } },
        newInsights: [],
        confidence: 0.7,
      },
      sessionsAnalyzed: 5,
      previousConfidence: 0.5,
      newConfidence: 0.7,
    });

    expect(tracker.getHistory().length).toBe(1);
  });

  it("should calculate confidence trend", () => {
    const tracker = new IncrementalReflector();
    
    tracker.recordUpdate({
      timestamp: Date.now(),
      updates: { updates: {}, newInsights: [], confidence: 0.5 },
      sessionsAnalyzed: 5,
      previousConfidence: 0.3,
      newConfidence: 0.5,
    });

    tracker.recordUpdate({
      timestamp: Date.now(),
      updates: { updates: {}, newInsights: [], confidence: 0.7 },
      sessionsAnalyzed: 10,
      previousConfidence: 0.5,
      newConfidence: 0.7,
    });

    tracker.recordUpdate({
      timestamp: Date.now(),
      updates: { updates: {}, newInsights: [], confidence: 0.8 },
      sessionsAnalyzed: 15,
      previousConfidence: 0.7,
      newConfidence: 0.8,
    });

    const trend = tracker.getConfidenceTrend();
    expect(trend).toBe("improving");
  });

  it("should track most changed fields", () => {
    const tracker = new IncrementalReflector();
    
    tracker.recordUpdate({
      timestamp: Date.now(),
      updates: { 
        updates: { preferences: { languages: ["typescript"] } }, 
        newInsights: [], 
        confidence: 0.6 
      },
      sessionsAnalyzed: 5,
      previousConfidence: 0.5,
      newConfidence: 0.6,
    });

    tracker.recordUpdate({
      timestamp: Date.now(),
      updates: { 
        updates: { preferences: { languages: ["typescript", "rust"] } }, 
        newInsights: [], 
        confidence: 0.7 
      },
      sessionsAnalyzed: 10,
      previousConfidence: 0.6,
      newConfidence: 0.7,
    });

    const mostChanged = tracker.getMostChangedFields();
    expect(mostChanged.length).toBeGreaterThan(0);
    expect(mostChanged[0].field).toBe("preferences");
  });

  it("should limit history size", () => {
    const tracker = new IncrementalReflector(3);
    
    for (let i = 0; i < 5; i++) {
      tracker.recordUpdate({
        timestamp: Date.now(),
        updates: { updates: {}, newInsights: [], confidence: 0.5 },
        sessionsAnalyzed: i * 5,
        previousConfidence: 0.5,
        newConfidence: 0.5,
      });
    }

    expect(tracker.getHistory().length).toBe(3);
  });
});
