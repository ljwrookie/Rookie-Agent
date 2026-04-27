import { describe, it, expect } from "vitest";
import { PermissionManager } from "../src/permissions/manager.js";

describe("PermissionManager", () => {
  it("allows whitelisted read tools by default", () => {
    const pm = new PermissionManager();
    expect(pm.check("file_read")).toBe("allow");
    expect(pm.check("search_code")).toBe("allow");
    expect(pm.check("git_status")).toBe("allow");
    expect(pm.check("git_diff")).toBe("allow");
  });

  it("asks for write/edit/shell tools by default", () => {
    const pm = new PermissionManager();
    expect(pm.check("file_write")).toBe("ask");
    expect(pm.check("file_edit")).toBe("ask");
    expect(pm.check("shell_execute")).toBe("ask");
  });

  it("defaults to ask for unknown tools", () => {
    const pm = new PermissionManager();
    expect(pm.check("mystery_tool_123")).toBe("ask");
  });

  it("user rules take precedence over defaults", () => {
    const pm = new PermissionManager();
    pm.loadFromSettings({
      permissions: [{ tool: "shell_execute", action: "allow" }],
    });
    expect(pm.check("shell_execute")).toBe("allow");
  });

  it("supports deny rules via loadFromSettings", () => {
    const pm = new PermissionManager();
    pm.loadFromSettings({
      permissions: [{ tool: "file_read", action: "deny" }],
    });
    expect(pm.check("file_read")).toBe("deny");
  });

  it("addRule prepends rule with highest priority", () => {
    const pm = new PermissionManager();
    pm.addRule({ tool: "file_write", action: "allow" });
    expect(pm.check("file_write")).toBe("allow");
  });

  it("supports glob patterns in tool name", () => {
    const pm = new PermissionManager();
    pm.addRule({ tool: "git_*", action: "allow" });
    expect(pm.check("git_commit")).toBe("allow");
    expect(pm.check("git_log")).toBe("allow");
  });

  it("args pattern filters matching rule", () => {
    const pm = new PermissionManager();
    pm.addRule({ tool: "shell_execute", args: "rm -rf", action: "deny" });
    expect(pm.check("shell_execute", { cmd: "ls -la" })).toBe("ask");
    expect(pm.check("shell_execute", { cmd: "rm -rf /" })).toBe("deny");
  });

  it("session rules take precedence over user rules", async () => {
    const pm = new PermissionManager();
    pm.loadFromSettings({ permissions: [{ tool: "file_edit", action: "deny" }] });
    expect(pm.check("file_edit")).toBe("deny");

    await pm.applyAskDecision("file_edit", { allowed: true, remember: "session" });
    expect(pm.check("file_edit")).toBe("allow");

    pm.clearSessionRules();
    expect(pm.check("file_edit")).toBe("deny");
  });

  it("once decisions do not register any rule", async () => {
    const pm = new PermissionManager();
    await pm.applyAskDecision("shell_execute", { allowed: true, remember: "once" });
    // default rule for shell_execute is ask
    expect(pm.check("shell_execute")).toBe("ask");
  });

  it("forever decisions notify persist handlers", async () => {
    const pm = new PermissionManager();
    const calls: Array<{ tool: string; action: string; scope: string }> = [];
    pm.onPersist((rule, scope) => {
      calls.push({ tool: rule.tool, action: rule.action, scope });
    });

    await pm.applyAskDecision("shell_execute", { allowed: true, remember: "forever" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ tool: "shell_execute", action: "allow", scope: "forever" });
    // forever also primes the session so the next check is immediate
    expect(pm.check("shell_execute")).toBe("allow");
  });

  it("session deny prevents subsequent invocation without persisting", async () => {
    const pm = new PermissionManager();
    const calls: number[] = [];
    pm.onPersist(() => { calls.push(1); });

    await pm.applyAskDecision("file_write", { allowed: false, remember: "session" });
    expect(pm.check("file_write")).toBe("deny");
    expect(calls).toHaveLength(0);
  });
});
