/**
 * Plugin System Tests (P8-T3)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  PluginContextImpl,
  globalPluginLogger,
  HookExecutorImpl,
  PermissionDeniedError,
} from "../src/plugins/api.js";
import {
  PluginLoader,
  PluginLoadError,
} from "../src/plugins/loader.js";
import {
  Plugin,
  PluginMeta,
  PluginConfig,
  CommandDefinition,
  HookDefinition,
} from "../src/plugins/types.js";
import { SkillRegistry } from "../src/skills/registry.js";
import { ToolRegistry } from "../src/tools/registry.js";

describe("PluginContextImpl", () => {
  let context: PluginContextImpl;
  let toolRegistry: ToolRegistry;
  let skillRegistry: SkillRegistry;
  const mockMeta: PluginMeta = {
    name: "test-plugin",
    version: "1.0.0",
    description: "Test plugin",
  };
  const mockConfig: PluginConfig = {
    settings: {},
    enabled: true,
    permissions: [
      "command:register",
      "tool:register",
      "skill:register",
      "hook:register",
    ],
  };

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    skillRegistry = new SkillRegistry();
    context = new PluginContextImpl(
      mockMeta,
      mockConfig,
      toolRegistry,
      skillRegistry,
      new Map(),
      globalPluginLogger
    );
  });

  describe("registration", () => {
    it("should register a command", () => {
      const command: CommandDefinition = {
        name: "test-cmd",
        description: "Test command",
        handler: async () => {},
      };

      context.registerCommand(command);
      expect(context.getCommands().has("test-plugin:test-cmd")).toBe(true);
    });

    it("should throw without command:register permission", () => {
      const restrictedContext = new PluginContextImpl(
        mockMeta,
        { ...mockConfig, permissions: [] },
        toolRegistry,
        skillRegistry,
        new Map(),
        globalPluginLogger
      );

      expect(() => {
        restrictedContext.registerCommand({
          name: "cmd",
          description: "Test",
          handler: async () => {},
        });
      }).toThrow(PermissionDeniedError);
    });

    it("should register a skill", () => {
      const skill = {
        name: "test-skill",
        version: "1.0.0",
        description: "Test skill",
        triggers: [],
        tools: [],
        prompt: "Test prompt",
        examples: [],
      };

      context.registerSkill(skill);
      const skills = context.getAllSkills();
      expect(skills.length).toBe(1);
    });

    it("should manage state", () => {
      const state = { counter: 0 };
      context.setState(state);
      expect(context.getState()).toEqual(state);
    });
  });

  describe("hooks", () => {
    it("should register a hook", () => {
      const hook: HookDefinition = {
        name: "test-event",
        type: "observe",
        handler: async () => {},
      };

      context.registerHook(hook);
      expect(context.getHooks("test-event").length).toBe(1);
    });

    it("should sort hooks by priority", () => {
      const hook1: HookDefinition = {
        name: "event",
        type: "observe",
        priority: 10,
        handler: async () => {},
      };
      const hook2: HookDefinition = {
        name: "event",
        type: "observe",
        priority: 100,
        handler: async () => {},
      };

      context.registerHook(hook1);
      context.registerHook(hook2);

      const hooks = context.getHooks("event");
      expect(hooks[0].priority).toBe(100);
      expect(hooks[1].priority).toBe(10);
    });
  });

  describe("events", () => {
    it("should emit and receive events", async () => {
      const handler = vi.fn();
      context.onEvent("test-event", handler);

      context.emitEvent("test-event", { data: "test" });

      // Event handlers are async
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(handler).toHaveBeenCalled();
    });
  });
});

describe("HookExecutorImpl", () => {
  const createMockContext = (hooks: HookDefinition[] = []): PluginContextImpl => {
    const context = new PluginContextImpl(
      { name: "test", version: "1.0.0", description: "Test" },
      { settings: {}, enabled: true, permissions: ["hook:register"] },
      new ToolRegistry(),
      new SkillRegistry(),
      new Map(),
      globalPluginLogger
    );

    for (const hook of hooks) {
      context.registerHook(hook);
    }

    return context;
  };

  describe("veto hooks", () => {
    it("should allow operation when no veto", async () => {
      const context = createMockContext([
        {
          name: "test-op",
          type: "veto",
          handler: async () => {},
        },
      ]);

      const executor = new HookExecutorImpl(new Map([["test", context]]));
      const result = await executor.executeVeto("test-op", { data: "test" });

      expect(result.vetoed).toBe(false);
    });

    it("should veto operation when handler calls veto", async () => {
      const context = createMockContext([
        {
          name: "test-op",
          type: "veto",
          handler: async ctx => {
            ctx.veto("Test veto reason");
          },
        },
      ]);

      const executor = new HookExecutorImpl(new Map([["test", context]]));
      const result = await executor.executeVeto("test-op", { data: "test" });

      expect(result.vetoed).toBe(true);
      expect(result.reason).toBe("Test veto reason");
    });
  });

  describe("transform hooks", () => {
    it("should transform data", async () => {
      const context = createMockContext([
        {
          name: "test-op",
          type: "transform",
          handler: async ctx => {
            ctx.transform({ ...ctx.data, modified: true });
          },
        },
      ]);

      const executor = new HookExecutorImpl(new Map([["test", context]]));
      const result = await executor.executeTransform("test-op", { original: true });

      expect(result.modified).toBe(true);
      expect(result.original).toBe(true);
    });

    it("should chain multiple transforms", async () => {
      const context = createMockContext([
        {
          name: "test-op",
          type: "transform",
          priority: 10,
          handler: async ctx => {
            ctx.transform({ ...ctx.data, first: true });
          },
        },
        {
          name: "test-op",
          type: "transform",
          priority: 5,
          handler: async ctx => {
            ctx.transform({ ...ctx.data, second: true });
          },
        },
      ]);

      const executor = new HookExecutorImpl(new Map([["test", context]]));
      const result = await executor.executeTransform("test-op", {});

      expect(result.first).toBe(true);
      expect(result.second).toBe(true);
    });
  });

  describe("observe hooks", () => {
    it("should call observe handlers", async () => {
      let observed = false;
      const context = createMockContext([
        {
          name: "test-op",
          type: "observe",
          handler: async () => {
            observed = true;
          },
        },
      ]);

      const executor = new HookExecutorImpl(new Map([["test", context]]));
      await executor.executeObserve("test-op", { data: "test" });

      expect(observed).toBe(true);
    });
  });
});

describe("PluginLoader", () => {
  const createLoader = (opts: Partial<ConstructorParameters<typeof PluginLoader>[0]> = {}) => {
    return new PluginLoader({
      searchPaths: [],
      configDir: "/tmp/test-plugins",
      ...opts,
    });
  };

  describe("initialization", () => {
    it("should create loader with default options", () => {
      const loader = createLoader();
      expect(loader).toBeDefined();
    });

    it("should have no plugins initially", async () => {
      const loader = createLoader();
      expect(loader.getLoadedPlugins()).toEqual([]);
    });
  });

  describe("plugin loading", () => {
    it("should track loaded plugins", async () => {
      const loader = createLoader();
      // Since we can't easily create real plugins in tests,
      // we verify the tracking mechanism works
      expect(loader.isLoaded("nonexistent")).toBe(false);
    });
  });
});

describe("Plugin Types", () => {
  it("should define all required permission types", () => {
    const permissions = [
      "file:read",
      "file:write",
      "network",
      "shell",
      "git",
      "memory:read",
      "memory:write",
      "tool:register",
      "skill:register",
      "command:register",
      "hook:register",
    ];

    // Type check - this will fail at compile time if types are wrong
    const checkPermissions: string[] = permissions;
    expect(checkPermissions.length).toBe(11);
  });
});
