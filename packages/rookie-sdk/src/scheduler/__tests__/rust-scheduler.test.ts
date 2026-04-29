/**
 * Rust-backed Scheduler tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { RustScheduler, getGlobalScheduler, setGlobalScheduler } from "../rust-scheduler.js";

describe("RustScheduler", () => {
  const mockOptions = {
    projectRoot: "/tmp",
    storePath: ".test/scheduler.json",
  };

  beforeEach(() => {
    setGlobalScheduler(null);
  });

  it("should initialize and dispose", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();
    await scheduler.dispose();
  });

  it("should schedule a task", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();

    const result = await scheduler.schedule(
      "test_task",
      "0 0 * * * *",
      "echo hello",
      5000
    );

    expect(result.success).toBe(true);
    expect(result.taskId).toBeDefined();

    await scheduler.dispose();
  });

  it("should reject invalid cron expressions", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();

    const result = await scheduler.schedule(
      "invalid_task",
      "invalid_cron",
      "echo hello"
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();

    await scheduler.dispose();
  });

  it("should cancel a task", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();

    const scheduleResult = await scheduler.schedule(
      "cancel_task",
      "0 0 * * * *",
      "echo hello"
    );

    expect(scheduleResult.success).toBe(true);

    const cancelResult = await scheduler.cancel(scheduleResult.taskId!);
    expect(cancelResult).toBe(true);

    const task = await scheduler.getTask(scheduleResult.taskId!);
    expect(task).toBeUndefined();

    await scheduler.dispose();
  });

  it("should list tasks", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();

    await scheduler.schedule("task1", "0 0 * * * *", "echo 1");
    await scheduler.schedule("task2", "0 0 * * * *", "echo 2");

    const tasks = await scheduler.listTasks();
    expect(tasks.length).toBeGreaterThanOrEqual(2);

    await scheduler.dispose();
  });

  it("should pause and resume tasks", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();

    const result = await scheduler.schedule("pause_test", "0 0 * * * *", "echo test");
    expect(result.success).toBe(true);

    const pauseResult = await scheduler.pause(result.taskId!);
    expect(pauseResult).toBe(true);

    let task = await scheduler.getTask(result.taskId!);
    expect(task?.enabled).toBe(false);

    const resumeResult = await scheduler.resume(result.taskId!);
    expect(resumeResult).toBe(true);

    task = await scheduler.getTask(result.taskId!);
    expect(task?.enabled).toBe(true);

    await scheduler.dispose();
  });

  it("should get task history", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();

    const result = await scheduler.schedule("history_test", "0 0 * * * *", "echo test");
    expect(result.success).toBe(true);

    const history = await scheduler.getHistory(result.taskId!);
    expect(Array.isArray(history)).toBe(true);

    await scheduler.dispose();
  });

  it("should handle event listeners", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();

    const events: string[] = [];
    const unsubscribe = scheduler.onEvent((event) => {
      events.push(event.type);
    });

    // Schedule a task to trigger an event
    await scheduler.schedule("event_test", "0 0 * * * *", "echo test");

    // Events are async, so wait a bit
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Cleanup
    unsubscribe();
    await scheduler.dispose();
  });

  it("should handle global singleton", () => {
    const scheduler1 = getGlobalScheduler();
    expect(scheduler1).toBeNull();

    const newScheduler = new RustScheduler(mockOptions);
    setGlobalScheduler(newScheduler);

    const scheduler2 = getGlobalScheduler();
    expect(scheduler2).toBe(newScheduler);

    setGlobalScheduler(null);
  });
});

describe("RustScheduler Cron Expressions", () => {
  const mockOptions = {
    projectRoot: "/tmp",
  };

  const validCronExpressions = [
    { expr: "* * * * * *", desc: "every second" },
    { expr: "0 * * * * *", desc: "every minute" },
    { expr: "0 0 * * * *", desc: "every hour" },
    { expr: "0 0 0 * * *", desc: "every day at midnight" },
    { expr: "0 0 0 * * 1", desc: "every Monday" },
    { expr: "0 0 0 1 * *", desc: "first day of month" },
    { expr: "*/5 * * * * *", desc: "every 5 seconds" },
    { expr: "0 0 9-17 * * 1-5", desc: "every hour 9-17 on weekdays" },
  ];

  for (const { expr, desc } of validCronExpressions) {
    it(`should accept valid cron: ${desc} (${expr})`, async () => {
      const scheduler = new RustScheduler(mockOptions);
      await scheduler.initialize();

      const result = await scheduler.schedule(`cron_${desc}`, expr, "echo test");
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      await scheduler.dispose();
    });
  }

  const invalidCronExpressions = [
    "invalid",
    "* * *",
    "99 * * * * *",
    "",
    "* * * * * * *",
  ];

  for (const expr of invalidCronExpressions) {
    it(`should reject invalid cron: "${expr}"`, async () => {
      const scheduler = new RustScheduler(mockOptions);
      await scheduler.initialize();

      const result = await scheduler.schedule("invalid_cron", expr, "echo test");
      expect(result.success).toBe(false);

      await scheduler.dispose();
    });
  }
});

describe("RustScheduler Precision", () => {
  const mockOptions = {
    projectRoot: "/tmp",
  };

  it("should schedule tasks with proper timing", async () => {
    const scheduler = new RustScheduler(mockOptions);
    await scheduler.initialize();

    const startTime = Date.now();

    const result = await scheduler.schedule(
      "precision_test",
      "*/1 * * * * *", // Every second
      "echo tick",
      5000
    );

    expect(result.success).toBe(true);

    const task = await scheduler.getTask(result.taskId!);
    expect(task).toBeDefined();

    // Next run should be calculated
    expect(task?.nextRun).toBeDefined();

    // Cleanup
    await scheduler.cancel(result.taskId!);
    await scheduler.dispose();
  });
});
