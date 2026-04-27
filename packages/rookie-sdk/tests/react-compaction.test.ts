import { describe, it, expect } from "vitest";
import { runReAct } from "../src/agent/react.js";
import { Compactor } from "../src/agent/compactor.js";
import type { Agent, AgentContext, AgentEvent, Message } from "../src/agent/types.js";
import type { ChatChunk, ChatParams, ChatWithToolsParams, ModelProvider } from "../src/models/types.js";
import { MemoryStore } from "../src/memory/store.js";
import { ToolRegistry } from "../src/tools/registry.js";

/**
 * Minimal model stub that streams a single "done" response and records the
 * messages it was invoked with on each call.
 */
function makeModel(): ModelProvider & { calls: Message[][] } {
  const calls: Message[][] = [];
  return {
    name: "stub",
    capabilities: {
      streaming: true,
      functionCalling: true,
      vision: false,
      maxTokens: 1024,
      contextWindow: 200,
    },
    calls,
    async *chatStream(params: ChatParams): AsyncGenerator<ChatChunk> {
      calls.push([...params.messages]);
      yield { type: "text", content: "ok" };
      yield { type: "done" };
    },
    async *chatWithToolsStream(params: ChatWithToolsParams): AsyncGenerator<ChatChunk> {
      calls.push([...params.messages]);
      yield { type: "text", content: "ok" };
      yield { type: "done" };
    },
  } as ModelProvider & { calls: Message[][] };
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe("runReAct + Compactor integration", () => {
  it("emits a `compacted` event and trims messages when over threshold", async () => {
    const model = makeModel();
    const memory = new MemoryStore(`/tmp/rookie-react-compact-${Date.now()}.db`);
    const tools = new ToolRegistry();

    const compactor = new Compactor({
      contextWindow: 200,
      triggerRatio: 0.5, // trigger aggressively for the test
      keepRecent: 2,
      summariser: async () => "earlier history",
      memory,
    });

    // 8 chunky history messages → well above 100-token threshold.
    const history: Message[] = Array.from({ length: 8 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "x".repeat(200) + ` turn-${i}`,
    }));

    const agent: Agent = {
      name: "stub",
      description: "",
      systemPrompt: "You are a test agent.",
      tools: [],
      run: async function* () { /* unused */ },
    };

    const context: AgentContext = {
      client: {} as AgentContext["client"],
      model,
      memory,
      tools,
      compactor,
    };

    const events: AgentEvent[] = await collect(
      runReAct(agent, { message: "hello", history }, context),
    );

    const compacted = events.find((e) => e.type === "compacted");
    expect(compacted, "runReAct should emit a `compacted` event").toBeDefined();
    if (compacted && compacted.type === "compacted") {
      expect(compacted.reason).toBe("threshold");
      expect(compacted.after.messages).toBeLessThan(compacted.before.messages);
    }

    // The model should have been called at least once with a compacted list:
    // the last observed call should contain the compaction system message.
    const lastCall = model.calls.at(-1)!;
    expect(lastCall.some((m) => m.role === "system" && m.content.includes("Compacted history"))).toBe(true);

    await memory.close();
  });

  it("does not compact when history is well under the threshold", async () => {
    const model = makeModel();
    const memory = new MemoryStore(`/tmp/rookie-react-nocompact-${Date.now()}.db`);
    const tools = new ToolRegistry();

    const compactor = new Compactor({
      contextWindow: 10000,
      triggerRatio: 0.8,
      keepRecent: 10,
      summariser: async () => "should-not-run",
    });

    const agent: Agent = {
      name: "stub",
      description: "",
      systemPrompt: "test",
      tools: [],
      run: async function* () { /* unused */ },
    };

    const context: AgentContext = {
      client: {} as AgentContext["client"],
      model,
      memory,
      tools,
      compactor,
    };

    const events = await collect(
      runReAct(agent, { message: "hi", history: [] }, context),
    );
    expect(events.find((e) => e.type === "compacted")).toBeUndefined();
    await memory.close();
  });
});
