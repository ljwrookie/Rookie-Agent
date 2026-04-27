import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  UserModelManager,
  SimpleReflector,
  createDefaultUserModel,
  UserModel,
} from "../src/memory/user-model.js";
import { Message } from "../src/agent/types.js";

describe("UserModelManager", () => {
  let dir: string;
  let manager: UserModelManager;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-user-model-"));
    manager = new UserModelManager({
      storageDir: dir,
      reflectionInterval: 5,
      minSessionsBeforeReflection: 3,
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("getModel", () => {
    it("creates default model for new user", async () => {
      const model = await manager.getModel("user-1");
      expect(model.userId).toBe("user-1");
      expect(model.sessionCount).toBe(0);
      expect(model.preferences.codeStyle).toBe("documented");
    });

    it("returns cached model on subsequent calls", async () => {
      const model1 = await manager.getModel("user-1");
      model1.sessionCount = 10;
      const model2 = await manager.getModel("user-1");
      expect(model2.sessionCount).toBe(10);
    });
  });

  describe("saveModel", () => {
    it("persists model to disk", async () => {
      const model = createDefaultUserModel("user-1");
      model.preferences.languages = ["typescript", "rust"];
      await manager.saveModel(model);

      // Create new manager to test loading
      const manager2 = new UserModelManager({ storageDir: dir });
      const loaded = await manager2.getModel("user-1");
      expect(loaded.preferences.languages).toEqual(["typescript", "rust"]);
    });
  });

  describe("recordSession", () => {
    it("increments session count", async () => {
      const messages: Message[] = [{ role: "user", content: "hello" }];
      const { model } = await manager.recordSession("user-1", messages);
      expect(model.sessionCount).toBe(1);
    });

    it("triggers reflection at interval", async () => {
      const messages: Message[] = [{ role: "user", content: "hello" }];

      // First 2 sessions - no reflection
      await manager.recordSession("user-1", messages);
      await manager.recordSession("user-1", messages);
      const result3 = await manager.recordSession("user-1", messages);
      expect(result3.shouldReflect).toBe(false); // sessionCount = 3

      // 4th and 5th sessions
      await manager.recordSession("user-1", messages);
      const result5 = await manager.recordSession("user-1", messages);
      expect(result5.shouldReflect).toBe(true); // sessionCount = 5, hits interval
    });
  });

  describe("applyReflectorOutput", () => {
    it("applies updates to model", async () => {
      const model = await manager.getModel("user-1");

      const output = {
        updates: {
          preferences: {
            languages: ["typescript"],
            codeStyle: "concise" as const,
          },
        },
        newInsights: ["User prefers TypeScript"],
        confidence: 0.8,
      };

      const updated = await manager.applyReflectorOutput("user-1", output);
      expect(updated.preferences.languages).toEqual(["typescript"]);
      expect(updated.preferences.codeStyle).toBe("concise");
      expect(updated.insights).toContain("User prefers TypeScript");
    });

    it("limits insights to 50", async () => {
      const model = createDefaultUserModel("user-1");
      model.insights = Array(45).fill("old insight");
      await manager.saveModel(model);

      const output = {
        updates: {},
        newInsights: Array(10).fill("new insight"),
        confidence: 0.8,
      };

      const updated = await manager.applyReflectorOutput("user-1", output);
      expect(updated.insights.length).toBe(50);
      expect(updated.insights[updated.insights.length - 1]).toBe("new insight");
    });
  });

  describe("getModelAsContext", () => {
    it("generates context string from model", async () => {
      const model = createDefaultUserModel("user-1");
      model.preferences.languages = ["typescript", "rust"];
      model.stack.frameworks = ["react", "express"];
      model.insights = ["User values testing"];

      const context = manager.getModelAsContext(model);
      expect(context).toContain("User Profile");
      expect(context).toContain("typescript");
      expect(context).toContain("react");
      expect(context).toContain("User values testing");
    });
  });

  describe("mergeIntoSystemPrompt", () => {
    it("appends user context to system prompt", async () => {
      const model = createDefaultUserModel("user-1");
      model.preferences.languages = ["python"];

      const merged = manager.mergeIntoSystemPrompt("You are a helpful assistant.", model);
      expect(merged).toContain("You are a helpful assistant.");
      expect(merged).toContain("User Profile");
      expect(merged).toContain("python");
    });
  });
});

describe("SimpleReflector", () => {
  let reflector: SimpleReflector;

  beforeEach(() => {
    reflector = new SimpleReflector();
  });

  describe("run", () => {
    it("detects programming languages", async () => {
      const sessions: Message[][] = [
        [
          { role: "user", content: "Help me with TypeScript and Node.js" },
          { role: "assistant", content: "Sure!" },
        ],
      ];

      const result = await reflector.run({ recentSessions: sessions, sessionCount: 5 });
      expect(result.updates.preferences?.languages).toContain("typescript");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("detects frameworks", async () => {
      const sessions: Message[][] = [
        [
          { role: "user", content: "How do I use React hooks?" },
          { role: "assistant", content: "Here's how..." },
        ],
      ];

      const result = await reflector.run({ recentSessions: sessions, sessionCount: 5 });
      expect(result.updates.stack?.frameworks).toContain("react");
    });

    it("detects communication style from brief messages", async () => {
      const sessions: Message[][] = [
        [
          { role: "user", content: "fix this" },
          { role: "assistant", content: "Done" },
          { role: "user", content: "thanks" },
        ],
      ];

      const result = await reflector.run({ recentSessions: sessions, sessionCount: 5 });
      expect(result.updates.communication?.detailLevel).toBe("brief");
    });

    it("detects communication style from detailed messages", async () => {
      const sessions: Message[][] = [
        [
          {
            role: "user",
            content:
              "I have a complex problem with my application that I've been struggling with for days. It started when I upgraded to the latest version of the framework. The error message says something about module resolution failing when I try to import components from my shared library. I've checked the tsconfig.json paths and they seem correct. Could you help me understand what might be causing this issue and how to resolve it? I've already tried clearing node_modules and reinstalling.",
          },
        ],
      ];

      const result = await reflector.run({ recentSessions: sessions, sessionCount: 5 });
      expect(result.updates.communication?.detailLevel).toBe("detailed");
    });

    it("generates insights about testing interest", async () => {
      const sessions: Message[][] = [
        [
          { role: "user", content: "How do I write tests for this function?" },
          { role: "assistant", content: "Use jest..." },
        ],
      ];

      const result = await reflector.run({ recentSessions: sessions, sessionCount: 5 });
      expect(result.newInsights.some((i) => i.includes("testing"))).toBe(true);
    });

    it("generates insights about performance interest", async () => {
      const sessions: Message[][] = [
        [
          { role: "user", content: "How can I optimize this query?" },
          { role: "assistant", content: "Add an index..." },
        ],
      ];

      const result = await reflector.run({ recentSessions: sessions, sessionCount: 5 });
      expect(result.newInsights.some((i) => i.includes("performance"))).toBe(true);
    });
  });
});
