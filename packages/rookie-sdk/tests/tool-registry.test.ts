import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/tools/registry.js";
import { PermissionManager } from "../src/permissions/manager.js";
import { HookRegistry } from "../src/hooks/registry.js";
import { RookieError, ErrorCode } from "../src/errors.js";
import type { Tool } from "../src/tools/types.js";

function makeEcho(name: string, action?: (params: Record<string, unknown>) => unknown): Tool {
  return {
    name,
    description: `Echo tool ${name}`,
    parameters: [{ name: "msg", type: "string", description: "Message" }],
    async execute(params) {
      return action ? action(params) : (params.msg as string) || "ok";
    },
  };
}

describe("ToolRegistry", () => {
  it("registers and invokes a tool", async () => {
    const reg = new ToolRegistry();
    reg.register(makeEcho("echo"));
    const out = await reg.invoke("echo", { msg: "hi" });
    expect(out).toBe("hi");
  });

  it("throws TOOL_NOT_FOUND for unknown tool", async () => {
    const reg = new ToolRegistry();
    await expect(reg.invoke("ghost", {})).rejects.toMatchObject({
      code: ErrorCode.TOOL_NOT_FOUND,
    });
  });

  it("denies tool when permission=deny", async () => {
    const pm = new PermissionManager();
    pm.addRule({ tool: "danger", action: "deny" });
    const reg = new ToolRegistry({ permissions: pm });
    reg.register(makeEcho("danger"));
    await expect(reg.invoke("danger", {})).rejects.toMatchObject({
      code: ErrorCode.TOOL_PERMISSION_DENIED,
    });
  });

  it("invokes onAskPermission callback when permission=ask", async () => {
    const pm = new PermissionManager();
    pm.addRule({ tool: "risky", action: "ask" });
    let asked = 0;
    const reg = new ToolRegistry({
      permissions: pm,
      onAskPermission: async () => {
        asked++;
        return true;
      },
    });
    reg.register(makeEcho("risky"));
    await reg.invoke("risky", { msg: "go" });
    expect(asked).toBe(1);
  });

  it("throws PERMISSION_DENIED when user denies via onAskPermission", async () => {
    const pm = new PermissionManager();
    pm.addRule({ tool: "risky", action: "ask" });
    const reg = new ToolRegistry({
      permissions: pm,
      onAskPermission: async () => false,
    });
    reg.register(makeEcho("risky"));
    await expect(reg.invoke("risky", {})).rejects.toMatchObject({
      code: ErrorCode.TOOL_PERMISSION_DENIED,
    });
  });

  it("blocks execution when PreToolUse hook rejects", async () => {
    const hooks = new HookRegistry();
    hooks.register({
      event: "PreToolUse",
      matcher: "blocked",
      command: "exit 1",
      canReject: true,
    });
    const pm = new PermissionManager();
    pm.addRule({ tool: "blocked", action: "allow" });
    const reg = new ToolRegistry({ permissions: pm, hooks });
    reg.register(makeEcho("blocked"));
    await expect(reg.invoke("blocked", {})).rejects.toMatchObject({
      code: ErrorCode.HOOK_REJECTED,
    });
  });

  it("wraps execution errors as TOOL_EXECUTION_ERROR", async () => {
    const reg = new ToolRegistry();
    reg.register(
      makeEcho("boom", () => {
        throw new Error("kaboom");
      })
    );
    await expect(reg.invoke("boom", {})).rejects.toMatchObject({
      code: ErrorCode.TOOL_EXECUTION_ERROR,
    });
  });

  it("AskDecision remember=session grants subsequent invocations", async () => {
    const pm = new PermissionManager();
    pm.addRule({ tool: "risky", action: "ask" });
    let asked = 0;
    const reg = new ToolRegistry({
      permissions: pm,
      onAskPermission: async () => {
        asked++;
        return { allowed: true, remember: "session" };
      },
    });
    reg.register(makeEcho("risky"));
    await reg.invoke("risky", { msg: "one" });
    await reg.invoke("risky", { msg: "two" });
    // Only the first call should trigger the prompt; session rule handles #2.
    expect(asked).toBe(1);
  });

  it("AskDecision remember=forever calls persist handler", async () => {
    const pm = new PermissionManager();
    pm.addRule({ tool: "risky", action: "ask" });
    const persisted: string[] = [];
    pm.onPersist((rule) => {
      persisted.push(`${rule.tool}:${rule.action}`);
    });
    const reg = new ToolRegistry({
      permissions: pm,
      onAskPermission: async () => ({ allowed: true, remember: "forever" }),
    });
    reg.register(makeEcho("risky"));
    await reg.invoke("risky", {});
    expect(persisted).toEqual(["risky:allow"]);
  });

  it("fires OnPermissionAsk hook with the resolved decision", async () => {
    const hooks = new HookRegistry();
    const captured: Array<{ allowed?: boolean; remember?: string; tool?: string }> = [];
    hooks.register({
      event: "OnPermissionAsk",
      // node-based fake that records the context into the closure via shell
      // would be brittle; we stub by spying on fire via a custom matcher using
      // a prompt-less hook with an intentionally unknown shape. Instead we
      // wire a matcher-less register and intercept through permission events
      // below.
      command: "true",
    });
    // Spy on fire to capture call arguments without invoking shell semantics.
    const origFire = hooks.fire.bind(hooks);
    hooks.fire = async (event, ctx) => {
      if (event === "OnPermissionAsk") {
        captured.push({
          allowed: ctx.permissionDecision?.allowed,
          remember: ctx.permissionDecision?.remember,
          tool: ctx.toolName,
        });
        return [];
      }
      return origFire(event, ctx);
    };

    const pm = new PermissionManager();
    pm.addRule({ tool: "risky", action: "ask" });
    const reg = new ToolRegistry({
      permissions: pm,
      hooks,
      onAskPermission: async () => ({ allowed: false, remember: "session" }),
    });
    reg.register(makeEcho("risky"));

    await expect(reg.invoke("risky", {})).rejects.toMatchObject({
      code: ErrorCode.TOOL_PERMISSION_DENIED,
    });
    expect(captured).toEqual([
      { allowed: false, remember: "session", tool: "risky" },
    ]);
  });
});
