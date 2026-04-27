import { describe, it, expect } from "vitest";
import { PermissionManager, PermissionDenialError } from "../src/permissions/manager.js";

describe("PermissionManager - Denial Tracking", () => {
  describe("denial counting", () => {
    it("increments consecutive denials on rejection", async () => {
      const manager = new PermissionManager();

      // First denial
      await manager.applyAskDecision("file_write", { allowed: false, remember: "once" });
      expect(manager.getDenialStats().consecutive).toBe(1);
      expect(manager.getDenialStats().total).toBe(1);

      // Second denial
      await manager.applyAskDecision("file_edit", { allowed: false, remember: "once" });
      expect(manager.getDenialStats().consecutive).toBe(2);
      expect(manager.getDenialStats().total).toBe(2);
    });

    it("resets consecutive denials on approval", async () => {
      const manager = new PermissionManager();

      // Two denials
      await manager.applyAskDecision("file_write", { allowed: false, remember: "once" });
      await manager.applyAskDecision("file_edit", { allowed: false, remember: "once" });
      expect(manager.getDenialStats().consecutive).toBe(2);

      // One approval resets consecutive
      await manager.applyAskDecision("shell_execute", { allowed: true, remember: "once" });
      expect(manager.getDenialStats().consecutive).toBe(0);
      expect(manager.getDenialStats().total).toBe(2); // Total unchanged
    });

    it("throws MAX_CONSECUTIVE_DENIALS_REACHED after 3 consecutive denials", async () => {
      const manager = new PermissionManager({ maxConsecutiveDenials: 3 });

      // First two denials should succeed
      await manager.applyAskDecision("file_write", { allowed: false, remember: "once" });
      await manager.applyAskDecision("file_edit", { allowed: false, remember: "once" });

      // Third denial should throw
      await expect(
        manager.applyAskDecision("shell_execute", { allowed: false, remember: "once" }),
      ).rejects.toThrow(PermissionDenialError);

      try {
        await manager.applyAskDecision("shell_execute", { allowed: false, remember: "once" });
      } catch (e) {
        expect(e).toBeInstanceOf(PermissionDenialError);
        expect((e as PermissionDenialError).code).toBe("MAX_CONSECUTIVE_DENIALS_REACHED");
      }
    });

    it("throws MAX_TOTAL_DENIALS_REACHED after 20 total denials", async () => {
      const manager = new PermissionManager({ maxTotalDenials: 5, maxConsecutiveDenials: 100 });

      // Reset between each denial to avoid consecutive limit
      for (let i = 0; i < 4; i++) {
        await manager.applyAskDecision("file_write", { allowed: false, remember: "once" });
        await manager.applyAskDecision("file_write", { allowed: true, remember: "once" });
      }

      expect(manager.getDenialStats().total).toBe(4);

      // Fifth denial should throw
      await expect(
        manager.applyAskDecision("file_write", { allowed: false, remember: "once" }),
      ).rejects.toThrow(PermissionDenialError);

      try {
        await manager.applyAskDecision("file_write", { allowed: false, remember: "once" });
      } catch (e) {
        expect(e).toBeInstanceOf(PermissionDenialError);
        expect((e as PermissionDenialError).code).toBe("MAX_TOTAL_DENIALS_REACHED");
      }
    });

    it("allows custom thresholds", async () => {
      const manager = new PermissionManager({
        maxConsecutiveDenials: 5,
        maxTotalDenials: 100,
      });

      // Should not throw at 3 denials with custom threshold
      for (let i = 0; i < 4; i++) {
        await manager.applyAskDecision("file_write", { allowed: false, remember: "once" });
      }

      expect(manager.getDenialStats().consecutive).toBe(4);
    });
  });

  describe("checkDenialLimits", () => {
    it("returns null when under limits", () => {
      const manager = new PermissionManager();
      expect(manager.checkDenialLimits()).toBeNull();
    });

    it("returns error code when consecutive limit reached", async () => {
      const manager = new PermissionManager({ maxConsecutiveDenials: 2 });

      // First denial - should not throw but should return error code from checkDenialLimits
      await manager.applyAskDecision("file_write", { allowed: false, remember: "once" });

      // After 1 denial with threshold of 2, checkDenialLimits should still return null
      expect(manager.checkDenialLimits()).toBeNull();

      // Second denial should throw because we check AFTER incrementing
      await expect(
        manager.applyAskDecision("file_edit", { allowed: false, remember: "once" }),
      ).rejects.toThrow(PermissionDenialError);
    });
  });

  describe("PermissionDenialError", () => {
    it("has correct error properties", () => {
      const error = new PermissionDenialError(
        "MAX_CONSECUTIVE_DENIALS_REACHED",
        "Test message",
        { consecutive: 3, total: 5 },
      );

      expect(error.name).toBe("PermissionDenialError");
      expect(error.code).toBe("MAX_CONSECUTIVE_DENIALS_REACHED");
      expect(error.consecutiveCount).toBe(3);
      expect(error.totalCount).toBe(5);
      expect(error.message).toBe("Test message");
    });
  });
});
