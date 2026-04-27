import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import {
  Scheduler,
  parseInterval,
  intervalToCron,
  intervalToString,
  getNextRunTime,
  generateTaskId,
  validateTask,
  loadSchedulerStore,
  saveSchedulerStore,
} from "../src/scheduler/index.js";

describe("parseInterval", () => {
  it("parses minutes expressions", () => {
    expect(parseInterval("5m")).toEqual({ type: "minutes", value: 5 });
    expect(parseInterval("30min")).toEqual({ type: "minutes", value: 30 });
    expect(parseInterval("5M")).toEqual({ type: "minutes", value: 5 });
  });

  it("parses hours expressions", () => {
    expect(parseInterval("1h")).toEqual({ type: "hours", value: 1 });
    expect(parseInterval("2hr")).toEqual({ type: "hours", value: 2 });
    expect(parseInterval("12hours")).toEqual({ type: "hours", value: 12 });
  });

  it("parses @daily and @HH:MM", () => {
    expect(parseInterval("@daily")).toEqual({ type: "daily", hour: 9, minute: 0 });
    expect(parseInterval("@14:30")).toEqual({ type: "daily", hour: 14, minute: 30 });
    expect(parseInterval("@09:05")).toEqual({ type: "daily", hour: 9, minute: 5 });
  });

  it("parses cron expressions", () => {
    expect(parseInterval("cron(0 9 * * *)")).toEqual({ type: "cron", expression: "0 9 * * *" });
    expect(parseInterval("cron(*/5 * * * *)")).toEqual({ type: "cron", expression: "*/5 * * * *" });
  });

  it("returns null for invalid expressions", () => {
    expect(parseInterval("invalid")).toBeNull();
    expect(parseInterval("1441m")).toBeNull(); // too many minutes
    expect(parseInterval("169h")).toBeNull(); // too many hours
    expect(parseInterval("cron(invalid)")).toBeNull();
  });
});

describe("intervalToCron", () => {
  it("converts minutes to cron", () => {
    expect(intervalToCron({ type: "minutes", value: 5 })).toBe("*/5 * * * *");
  });

  it("converts hours to cron", () => {
    expect(intervalToCron({ type: "hours", value: 2 })).toBe("0 */2 * * *");
  });

  it("converts daily to cron", () => {
    expect(intervalToCron({ type: "daily", hour: 9, minute: 30 })).toBe("30 9 * * *");
  });

  it("passes through cron expressions", () => {
    expect(intervalToCron({ type: "cron", expression: "0 0 * * 0" })).toBe("0 0 * * 0");
  });
});

describe("intervalToString", () => {
  it("formats intervals", () => {
    expect(intervalToString({ type: "minutes", value: 5 })).toBe("5m");
    expect(intervalToString({ type: "hours", value: 1 })).toBe("1h");
    expect(intervalToString({ type: "daily", hour: 9, minute: 5 })).toBe("@09:05");
    expect(intervalToString({ type: "cron", expression: "0 9 * * *" })).toBe("cron(0 9 * * *)");
  });
});

describe("getNextRunTime", () => {
  it("calculates next run for minutes", () => {
    const now = Date.now();
    const next = getNextRunTime({ type: "minutes", value: 5 }, now);
    expect(next).toBe(now + 5 * 60 * 1000);
  });

  it("calculates next run for hours", () => {
    const now = Date.now();
    const next = getNextRunTime({ type: "hours", value: 1 }, now);
    expect(next).toBe(now + 60 * 60 * 1000);
  });
});

describe("validateTask", () => {
  it("validates required fields", () => {
    expect(validateTask({})).toBe("Task name is required");
    expect(validateTask({ name: "test" })).toBe("Command is required");
    expect(validateTask({ name: "test", command: "echo hi" })).toBe("Interval is required");
    expect(validateTask({ name: "test", command: "echo hi", interval: { type: "minutes", value: 5 } })).toBeNull();
  });
});

describe("Scheduler persistence", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-scheduler-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves and loads scheduler store", async () => {
    const store = {
      version: 1 as const,
      tasks: [{
        id: "t1",
        name: "test",
        command: "echo hi",
        interval: { type: "minutes" as const, value: 5 },
        enabled: true,
        createdAt: Date.now(),
        runCount: 0,
      }],
    };
    await saveSchedulerStore(dir, store);
    const loaded = await loadSchedulerStore(dir);
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0].id).toBe("t1");
  });

  it("returns empty store if file missing", async () => {
    const loaded = await loadSchedulerStore(dir);
    expect(loaded.tasks).toHaveLength(0);
  });
});

describe("Scheduler", () => {
  let dir: string;
  let scheduler: Scheduler;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "rookie-scheduler-"));
    scheduler = new Scheduler({ projectRoot: dir });
    await scheduler.initialize();
  });

  afterEach(async () => {
    await scheduler.dispose();
    await rm(dir, { recursive: true, force: true });
  });

  it("schedules a task", async () => {
    const result = await scheduler.schedule("Test Task", "echo hello", "5m");
    expect(result.success).toBe(true);
    expect(result.task).toBeDefined();
    expect(result.task!.name).toBe("Test Task");
    expect(result.task!.command).toBe("echo hello");
    expect(result.task!.interval.type).toBe("minutes");
  });

  it("rejects invalid interval", async () => {
    const result = await scheduler.schedule("Test", "echo hi", "invalid");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid interval");
  });

  it("lists scheduled tasks", async () => {
    await scheduler.schedule("Task 1", "echo 1", "5m");
    await scheduler.schedule("Task 2", "echo 2", "1h");
    const tasks = scheduler.getTasks();
    expect(tasks).toHaveLength(2);
  });

  it("unschedules a task", async () => {
    const result = await scheduler.schedule("To Remove", "echo bye", "5m");
    const id = result.task!.id;
    const success = await scheduler.unschedule(id);
    expect(success).toBe(true);
    expect(scheduler.getTasks()).toHaveLength(0);
  });

  it("returns false when unscheduling non-existent task", async () => {
    const success = await scheduler.unschedule("non-existent");
    expect(success).toBe(false);
  });

  it("enables/disables tasks", async () => {
    const result = await scheduler.schedule("Toggle", "echo toggle", "5m");
    const id = result.task!.id;
    expect(result.task!.enabled).toBe(true);

    const disabled = await scheduler.enable(id, false);
    expect(disabled).toBe(true);

    const task = scheduler.getTask(id);
    expect(task!.enabled).toBe(false);
  });

  it("emits events", async () => {
    const events: string[] = [];
    const unsubscribe = scheduler.onEvent((e) => {
      events.push(e.type);
    });

    const result = await scheduler.schedule("Event Test", "echo event", "5m");
    expect(events).toContain("task_scheduled");

    await scheduler.unschedule(result.task!.id);
    expect(events).toContain("task_cancelled");

    unsubscribe();
  });
});
