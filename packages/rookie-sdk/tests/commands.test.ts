import { describe, it, expect } from "vitest";
import {
  CommandRegistry,
  createDefaultRegistry,
  parseCommandInput,
  registerDefaults,
  DEFAULT_COMMANDS,
} from "../src/commands/index.js";
import type { Skill } from "../src/skills/types.js";

describe("parseCommandInput", () => {
  it("extracts name and args from /cmd form", () => {
    expect(parseCommandInput("/diff --staged")).toEqual({
      name: "diff",
      args: ["--staged"],
    });
  });

  it("returns empty name for non-slash input", () => {
    expect(parseCommandInput("hello world")).toEqual({ name: "", args: [] });
  });

  it("is case insensitive on the command name", () => {
    expect(parseCommandInput("/HELP")).toEqual({ name: "help", args: [] });
  });
});

describe("CommandRegistry", () => {
  it("registers and retrieves a command (case insensitive)", () => {
    const reg = new CommandRegistry();
    reg.register({
      name: "ping",
      description: "say pong",
      handler: async () => ({ prompt: "pong" }),
    });
    expect(reg.has("ping")).toBe(true);
    expect(reg.has("PING")).toBe(true);
    expect(reg.get("/ping")?.description).toBe("say pong");
  });

  it("resolves aliases", () => {
    const reg = new CommandRegistry();
    reg.register({
      name: "tests",
      description: "run tests",
      aliases: ["t", "runtests"],
      handler: async () => ({ prompt: "go" }),
    });
    expect(reg.get("t")?.name).toBe("tests");
    expect(reg.get("/runtests")?.name).toBe("tests");
  });

  it("later register() overrides prior command with same name", () => {
    const reg = new CommandRegistry();
    reg.register({ name: "x", description: "a", handler: async () => ({}) });
    reg.register({ name: "x", description: "b", handler: async () => ({}) });
    expect(reg.get("x")?.description).toBe("b");
  });

  it("filter() ranks primary-name matches above alias matches", () => {
    const reg = new CommandRegistry();
    reg.register({
      name: "alpha",
      description: "",
      aliases: ["a"],
      handler: async () => ({}),
    });
    reg.register({
      name: "beta",
      description: "",
      aliases: ["also"],
      handler: async () => ({}),
    });
    const hits = reg.filter("a").map((c) => c.name);
    // "alpha" has a primary match; "beta" matches only via the "also" alias.
    expect(hits).toEqual(["alpha", "beta"]);
  });

  it("execute() runs the handler and returns the result", async () => {
    const reg = new CommandRegistry();
    reg.register({
      name: "echo",
      description: "",
      handler: async (ctx) => ({ prompt: `echo:${ctx.args.join(" ")}` }),
    });
    const result = await reg.execute("/echo hi there");
    expect(result).toEqual({ prompt: "echo:hi there" });
  });

  it("execute() returns a systemMessage for unknown commands", async () => {
    const reg = new CommandRegistry();
    const result = await reg.execute("/ghost");
    expect(result?.systemMessage).toMatch(/Unknown command: \/ghost/);
  });

  it("execute() returns null for non-slash input", async () => {
    const reg = new CommandRegistry();
    expect(await reg.execute("hello")).toBeNull();
  });
});

describe("registerDefaults", () => {
  it("registers the roadmap-required defaults", () => {
    const reg = registerDefaults(new CommandRegistry());
    // P1-T2 explicit requirement: these must exist.
    const required = [
      "plan", "commit", "review", "verify", "compact",
      "schedule", "hook", "doctor", "skill", "config", "todo",
    ];
    for (const name of required) {
      expect(reg.has(name), `/${name} should be registered`).toBe(true);
    }
  });

  it("default /plan switches mode, /commit yields a prompt", async () => {
    const reg = createDefaultRegistry();
    const planOut = await reg.execute("/plan");
    expect(planOut?.mode).toBe("plan");
    const commitOut = await reg.execute("/commit");
    expect(commitOut?.prompt).toMatch(/commit message/i);
  });

  it("exports DEFAULT_COMMANDS as a usable array", () => {
    expect(DEFAULT_COMMANDS.length).toBeGreaterThanOrEqual(11);
    for (const cmd of DEFAULT_COMMANDS) {
      expect(cmd.handler).toBeTypeOf("function");
    }
  });
});

describe("CommandRegistry.fromSkill", () => {
  it("bridges a skill with a command trigger to a slash command", async () => {
    const skill: Skill = {
      name: "scaffold",
      version: "1.0",
      description: "Generate a new module scaffold",
      triggers: [{ type: "command", value: "/scaffold" }],
      tools: [],
      prompt: "You scaffold new modules.",
      examples: [],
    };
    const cmd = CommandRegistry.fromSkill(skill);
    expect(cmd).not.toBeNull();
    expect(cmd!.name).toBe("scaffold");
    expect(cmd!.category).toBe("skill");
    const result = await cmd!.handler({
      raw: "/scaffold auth",
      name: "scaffold",
      args: ["auth"],
      cwd: ".",
    });
    // Handler should hand the skill's prompt back to the agent loop and
    // include trailing args so the skill can see them.
    expect(result.prompt).toContain("You scaffold new modules.");
    expect(result.prompt).toContain("Args: auth");
  });

  it("returns null when the skill has no command trigger", () => {
    const skill: Skill = {
      name: "pattern-only",
      version: "1.0",
      description: "",
      triggers: [{ type: "pattern", value: "foo" }],
      tools: [],
      prompt: "",
      examples: [],
    };
    expect(CommandRegistry.fromSkill(skill)).toBeNull();
  });

  it("registerSkills() lets a skill override a builtin of the same name", async () => {
    const reg = createDefaultRegistry();
    expect(reg.get("review")?.source).toBe("builtin");
    const custom: Skill = {
      name: "custom-review",
      version: "1.0",
      description: "custom review flow",
      triggers: [{ type: "command", value: "/review" }],
      tools: [],
      prompt: "Use the team's custom review checklist.",
      examples: [],
    };
    const added = reg.registerSkills([custom]);
    expect(added).toBe(1);
    expect(reg.get("review")?.source).toBe("skill");
    const out = await reg.execute("/review");
    expect(out?.prompt).toMatch(/team's custom review checklist/);
  });
});
