/**
 * Rust-backed Blackboard tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RustBlackboard, getGlobalBlackboard, setGlobalBlackboard } from "../blackboard-rust.js";

describe("RustBlackboard", () => {
  let blackboard: RustBlackboard;

  beforeEach(() => {
    blackboard = new RustBlackboard();
    setGlobalBlackboard(null);
  });

  it("should set and get values", async () => {
    await blackboard.set("key1", "value1", "test");
    const value = await blackboard.get("key1");
    expect(value).toBe("value1");
  });

  it("should get entry with metadata", async () => {
    await blackboard.set("key1", "value1", "author1");
    const entry = await blackboard.getEntry("key1");

    expect(entry).not.toBeNull();
    expect(entry?.key).toBe("key1");
    expect(entry?.value).toBe("value1");
    expect(entry?.author).toBe("author1");
    expect(entry?.version).toBeGreaterThanOrEqual(1);
    expect(entry?.timestamp).toBeGreaterThan(0);
  });

  it("should handle CAS operations", async () => {
    await blackboard.set("key1", "initial", "test");
    const entry = await blackboard.getEntry("key1");

    // Successful CAS
    const success = await blackboard.cas("key1", entry!.version, "updated", "test");
    expect(success).toBe(true);

    const updated = await blackboard.get("key1");
    expect(updated).toBe("updated");

    // Failed CAS (stale version)
    const failed = await blackboard.cas("key1", entry!.version, "stale", "test");
    expect(failed).toBe(false);
  });

  it("should check key existence", async () => {
    expect(await blackboard.has("nonexistent")).toBe(false);
    await blackboard.set("exists", "value", "test");
    expect(await blackboard.has("exists")).toBe(true);
  });

  it("should delete keys", async () => {
    await blackboard.set("todelete", "value", "test");
    expect(await blackboard.has("todelete")).toBe(true);

    const deleted = await blackboard.delete("todelete", "test");
    expect(deleted).toBe(true);
    expect(await blackboard.has("todelete")).toBe(false);
  });

  it("should list keys", async () => {
    await blackboard.set("key1", "value1", "test");
    await blackboard.set("key2", "value2", "test");
    await blackboard.set("prefix:key3", "value3", "test");

    const allKeys = await blackboard.keys();
    expect(allKeys).toContain("key1");
    expect(allKeys).toContain("key2");

    const prefixKeys = await blackboard.keys("prefix:");
    expect(prefixKeys).toContain("prefix:key3");
    expect(prefixKeys).not.toContain("key1");
  });

  it("should get snapshot", async () => {
    await blackboard.set("key1", "value1", "test");
    await blackboard.set("key2", "value2", "test");

    const snapshot = await blackboard.snapshot();
    expect(Object.keys(snapshot)).toHaveLength(2);
    expect(snapshot["key1"].value).toBe("value1");
    expect(snapshot["key2"].value).toBe("value2");
  });

  it("should count entries", async () => {
    expect(await blackboard.count()).toBe(0);
    await blackboard.set("key1", "value1", "test");
    await blackboard.set("key2", "value2", "test");
    expect(await blackboard.count()).toBe(2);
  });

  it("should handle complex values", async () => {
    const complex = {
      string: "value",
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      nested: { key: "value" },
    };

    await blackboard.set("complex", complex, "test");
    const retrieved = await blackboard.get("complex");
    expect(retrieved).toEqual(complex);
  });

  it("should handle namespace operations", async () => {
    await blackboard.setInNamespace("ns1", "key", "value1", "test");
    await blackboard.setInNamespace("ns2", "key", "value2", "test");

    const val1 = await blackboard.getFromNamespace("ns1", "key");
    const val2 = await blackboard.getFromNamespace("ns2", "key");

    expect(val1).toBe("value1");
    expect(val2).toBe("value2");

    const namespaces = await blackboard.listNamespaces();
    expect(namespaces).toContain("ns1");
    expect(namespaces).toContain("ns2");
  });

  it("should handle global singleton", () => {
    const board1 = getGlobalBlackboard();
    const board2 = getGlobalBlackboard();
    expect(board1).toBe(board2);

    const newBoard = new RustBlackboard();
    setGlobalBlackboard(newBoard);
    expect(getGlobalBlackboard()).toBe(newBoard);
  });
});

describe("RustBlackboard Concurrency", () => {
  it("should handle concurrent writes", async () => {
    const blackboard = new RustBlackboard();
    const promises: Promise<void>[] = [];

    // 100 concurrent writes to different keys
    for (let i = 0; i < 100; i++) {
      promises.push(blackboard.set(`key_${i}`, `value_${i}`, "test"));
    }

    await Promise.all(promises);

    // Verify all keys exist
    for (let i = 0; i < 100; i++) {
      const value = await blackboard.get(`key_${i}`);
      expect(value).toBe(`value_${i}`);
    }
  });

  it("should handle concurrent CAS operations", async () => {
    const blackboard = new RustBlackboard();
    await blackboard.set("counter", 0, "init");

    const promises: Promise<boolean>[] = [];

    // Multiple CAS operations
    for (let i = 0; i < 50; i++) {
      promises.push(
        (async () => {
          let attempts = 0;
          while (attempts < 10) {
            const entry = await blackboard.getEntry("counter");
            const current = (entry?.value as number) || 0;
            const success = await blackboard.cas(
              "counter",
              entry!.version,
              current + 1,
              "test"
            );
            if (success) return true;
            attempts++;
          }
          return false;
        })()
      );
    }

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r).length;

    // Most operations should succeed
    expect(successCount).toBeGreaterThan(40);

    // Counter should be incremented
    const final = await blackboard.get("counter");
    expect(final).toBeGreaterThan(0);
  });
});
