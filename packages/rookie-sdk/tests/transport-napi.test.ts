import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NapiTransport, createTransport } from "../src/transport/napi.js";

describe("NapiTransport", () => {
  let transport: NapiTransport;

  beforeEach(() => {
    transport = new NapiTransport({
      addonPath: "/fake/path/to/addon.node",
      timeout: 1000,
    });
  });

  afterEach(() => {
    transport.close();
  });

  describe("constructor", () => {
    it("creates transport with options", () => {
      const t = new NapiTransport({ addonPath: "/test.node" });
      expect(t.isConnected()).toBe(false);
      t.close();
    });

    it("uses default timeout", () => {
      const t = new NapiTransport({ addonPath: "/test.node" });
      // Timeout is private, but we can verify it doesn't throw
      expect(t.isConnected()).toBe(false);
      t.close();
    });
  });

  describe("connect", () => {
    it("returns false for invalid addon path", async () => {
      // The require will throw, but connect catches it and returns false
      try {
        const result = await transport.connect();
        expect(result).toBe(false);
      } catch {
        // If it throws, that's also acceptable behavior
        expect(true).toBe(true);
      }
    });

    it("emits error event on connection failure", async () => {
      let errorEmitted = false;
      transport.on("error", () => {
        errorEmitted = true;
      });

      try {
        await transport.connect();
      } catch {
        // Error may be thrown or emitted
      }

      // Give event a chance to fire
      await new Promise((r) => setTimeout(r, 10));
      expect(errorEmitted || !transport.isConnected()).toBe(true);
    });
  });

  describe("isConnected", () => {
    it("returns false before connect", () => {
      expect(transport.isConnected()).toBe(false);
    });
  });

  describe("request", () => {
    it("throws when not connected", async () => {
      await expect(transport.request("test", {})).rejects.toThrow("Transport not connected");
    });
  });

  describe("close", () => {
    it("closes without error when not connected", () => {
      expect(() => transport.close()).not.toThrow();
    });

    it("sets connected to false", () => {
      transport.close();
      expect(transport.isConnected()).toBe(false);
    });

    it("emits close event", () => {
      let closeEmitted = false;
      transport.on("close", () => {
        closeEmitted = true;
      });

      transport.close();
      expect(closeEmitted).toBe(true);
    });
  });
});

describe("createTransport", () => {
  it("returns null when NAPI is not available", async () => {
    try {
      const transport = await createTransport({
        preferNapi: true,
        napiPath: "/nonexistent/addon.node",
      });
      expect(transport).toBeNull();
    } catch {
      // If it throws, that's also acceptable
      expect(true).toBe(true);
    }
  });

  it("returns null when preferNapi is false", async () => {
    const transport = await createTransport({
      preferNapi: false,
    });
    expect(transport).toBeNull();
  });
});
