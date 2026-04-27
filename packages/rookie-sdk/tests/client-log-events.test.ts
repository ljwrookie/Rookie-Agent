import { describe, it, expect } from "vitest";
import { InProcTransport } from "../src/transport/inproc.js";
import { RookieClient } from "../src/client.js";
import type { LogRecord } from "../src/logger/index.js";

describe("RookieClient.onLog", () => {
  it("forwards log.event notifications and supports unsubscribe", () => {
    const transport = new InProcTransport();
    const client = new RookieClient(transport);
    const received: LogRecord[] = [];

    const unsubscribe = client.onLog((rec) => { received.push(rec); });

    transport.emitNotification({
      jsonrpc: "2.0",
      method: "log.event",
      params: { msg: "rpc.complete", level: "info", method: "index.build", duration_ms: 7 },
    });

    // Non-log notifications are ignored.
    transport.emitNotification({
      jsonrpc: "2.0",
      method: "session.progress",
      params: { step: 1 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].msg).toBe("rpc.complete");
    expect((received[0] as Record<string, unknown>).method).toBe("index.build");

    unsubscribe();
    transport.emitNotification({
      jsonrpc: "2.0",
      method: "log.event",
      params: { msg: "after-unsub" },
    });
    expect(received).toHaveLength(1);
  });

  it("silently drops malformed payloads", () => {
    const transport = new InProcTransport();
    const client = new RookieClient(transport);
    const received: LogRecord[] = [];
    client.onLog((rec) => { received.push(rec); });

    transport.emitNotification({
      jsonrpc: "2.0",
      method: "log.event",
      params: { level: "info" }, // missing msg
    });

    expect(received).toHaveLength(0);
  });
});
