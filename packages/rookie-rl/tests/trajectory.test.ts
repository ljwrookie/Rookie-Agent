import { describe, it, expect, beforeEach } from "vitest";
import {
  TrajectoryStore,
  type Trajectory,
  type TrajectoryStep,
} from "../src/trajectory/store.js";

describe("TrajectoryStore", () => {
  let store: TrajectoryStore;

  beforeEach(() => {
    store = new TrajectoryStore();
  });

  it("should create a trajectory", () => {
    const trajectory = store.createTrajectory("session-1", "test task");

    expect(trajectory.id).toBeDefined();
    expect(trajectory.sessionId).toBe("session-1");
    expect(trajectory.task).toBe("test task");
    expect(trajectory.steps).toHaveLength(0);
    expect(trajectory.totalReward).toBe(0);
  });

  it("should add steps to a trajectory", () => {
    const trajectory = store.createTrajectory("session-1", "test task");

    const step = store.addStep(trajectory.id, {
      observation: "test obs",
      action: {
        type: "tool",
        content: "test action",
      },
      reward: 1.0,
      done: false,
    });

    expect(step.id).toBeDefined();
    expect(step.timestamp).toBeDefined();

    const updated = store.getTrajectory(trajectory.id);
    expect(updated?.steps).toHaveLength(1);
    expect(updated?.totalReward).toBe(1.0);
  });

  it("should complete a trajectory", () => {
    const trajectory = store.createTrajectory("session-1", "test task");

    store.completeTrajectory(trajectory.id, true, 10.0);

    const completed = store.getTrajectory(trajectory.id);
    expect(completed?.success).toBe(true);
    expect(completed?.endTime).toBeDefined();
    expect(completed?.totalReward).toBe(10.0);
  });

  it("should get trajectories by session", () => {
    store.createTrajectory("session-1", "task 1");
    store.createTrajectory("session-1", "task 2");
    store.createTrajectory("session-2", "task 3");

    const session1Trajectories = store.getTrajectoriesBySession("session-1");
    expect(session1Trajectories).toHaveLength(2);
  });

  it("should get successful trajectories", () => {
    const t1 = store.createTrajectory("session-1", "task 1");
    const t2 = store.createTrajectory("session-1", "task 2");

    store.completeTrajectory(t1.id, true);
    store.completeTrajectory(t2.id, false);

    const successful = store.getSuccessfulTrajectories();
    expect(successful).toHaveLength(1);
    expect(successful[0].id).toBe(t1.id);
  });

  it("should calculate statistics", () => {
    const t1 = store.createTrajectory("session-1", "task 1");
    const t2 = store.createTrajectory("session-1", "task 2");

    store.addStep(t1.id, {
      observation: "obs",
      action: { type: "tool", content: "action" },
      reward: 5.0,
      done: true,
    });

    store.addStep(t2.id, {
      observation: "obs",
      action: { type: "tool", content: "action" },
      reward: 10.0,
      done: true,
    });

    const stats = store.getStats();
    expect(stats.total).toBe(2);
    expect(stats.averageReward).toBe(7.5);
    expect(stats.averageLength).toBe(1);
  });

  it("should delete a trajectory", () => {
    const trajectory = store.createTrajectory("session-1", "task");

    const deleted = store.deleteTrajectory(trajectory.id);
    expect(deleted).toBe(true);

    const notFound = store.getTrajectory(trajectory.id);
    expect(notFound).toBeUndefined();
  });

  it("should export and import trajectories", () => {
    const trajectory = store.createTrajectory("session-1", "task");
    store.addStep(trajectory.id, {
      observation: "obs",
      action: { type: "tool", content: "action" },
      reward: 5.0,
      done: true,
    });

    const json = store.exportToJSON();
    expect(json).toContain("session-1");

    const newStore = new TrajectoryStore();
    newStore.importFromJSON(json);

    const imported = newStore.getTrajectory(trajectory.id);
    expect(imported).toBeDefined();
    expect(imported?.sessionId).toBe("session-1");
    expect(imported?.steps).toHaveLength(1);
  });
});
