import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentOrchestrator } from "../src/agent/orchestrator.js";
import { Plan } from "../src/agent/planner.js";
import { Logger } from "../src/logger/logger.js";
import type { AgentContext } from "../src/agent/types.js";

/** Collect every event into a flat array for easier assertions. */
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

// Minimal context — GAN with injected generator never touches these.
const DUMMY_CONTEXT = {} as AgentContext;

describe("AgentOrchestrator.runGAN", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "rookie-gan-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes on round 1 when generator output satisfies evaluator", async () => {
    const orch = new AgentOrchestrator();
    const events = await collect(
      orch.runGAN("Ship feature", DUMMY_CONTEXT, {
        generator: async (plan: Plan) => {
          // Output mentions every step so coverage is high, and has headings.
          return [
            "# Ship feature",
            "",
            ...plan.steps.map((s) => `## ${s.title}\nDone.`),
          ].join("\n");
        },
        evaluatorOptions: { threshold: 0.5 },
      })
    );

    const done = events.find((e: any) => e.type === "gan_done") as any;
    expect(done).toBeTruthy();
    expect(done.data.passed).toBe(true);
    expect(done.data.rounds.length).toBe(1);

    const planCreated = events.find((e: any) => e.type === "plan_created");
    expect(planCreated).toBeTruthy();

    const ganRound = events.find((e: any) => e.type === "gan_round") as any;
    expect(ganRound.data.round).toBe(1);
    expect(ganRound.data.pass).toBe(true);
  });

  it("retries up to maxRounds when evaluator keeps failing", async () => {
    const orch = new AgentOrchestrator();
    const events = await collect(
      orch.runGAN("Ship feature", DUMMY_CONTEXT, {
        generator: async () => "", // empty output -> correctness=0
        maxRounds: 3,
      })
    );

    const rounds = events.filter((e: any) => e.type === "gan_round");
    expect(rounds.length).toBe(3);

    const revisions = events.filter((e: any) => e.type === "plan_revised");
    expect(revisions.length).toBe(2); // rounds 2 and 3 revise the plan

    const done = events.find((e: any) => e.type === "gan_done") as any;
    expect(done.data.passed).toBe(false);
    expect(done.data.rounds.length).toBe(3);
  });

  it("threads critique back into the planner on revision", async () => {
    const orch = new AgentOrchestrator();
    const events = await collect(
      orch.runGAN("Ship feature", DUMMY_CONTEXT, {
        generator: async () => "too short",
        maxRounds: 2,
      })
    );

    const revised = events.find((e: any) => e.type === "plan_revised") as any;
    expect(revised).toBeTruthy();
    const revisedPlan = revised.data.plan as Plan;
    expect(revisedPlan.revision).toBe(2);
    expect(revisedPlan.notes).toMatch(/Revised after critique/i);
  });

  it("writes rubric scores to logger on every round", async () => {
    const logPath = join(dir, "app.log.jsonl");
    const logger = new Logger({ dir, baseName: "app" });

    const orch = new AgentOrchestrator();
    await collect(
      orch.runGAN("Ship feature", DUMMY_CONTEXT, {
        generator: async () => "# ok\nresponse",
        maxRounds: 2,
        logger,
      })
    );

    // Logger writes app-YYYY-MM-DD.jsonl daily-rotated file; grab the first.
    const files = require("node:fs").readdirSync(dir) as string[];
    const logFile = files.find((f) => f.startsWith("app") && f.endsWith(".jsonl"));
    expect(logFile).toBeTruthy();

    const contents = readFileSync(join(dir, logFile!), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));

    const rounds = contents.filter((r) => r.msg === "gan.round");
    expect(rounds.length).toBeGreaterThan(0);
    expect(rounds[0].scores).toBeDefined();
    expect(Array.isArray(rounds[0].scores)).toBe(true);
    expect(rounds[0].scores[0]).toHaveProperty("axis");

    const doneRec = contents.find((r) => r.msg === "gan.done");
    expect(doneRec).toBeTruthy();
  });

  it("propagates generator errors as agent_error and stops", async () => {
    const orch = new AgentOrchestrator();
    const events = await collect(
      orch.runGAN("Ship feature", DUMMY_CONTEXT, {
        generator: async () => {
          throw new Error("boom");
        },
        maxRounds: 3,
      })
    );

    const err = events.find((e: any) => e.type === "agent_error") as any;
    expect(err).toBeTruthy();
    expect(err.error).toContain("boom");

    const rounds = events.filter((e: any) => e.type === "gan_round");
    expect(rounds.length).toBe(0);
  });
});
