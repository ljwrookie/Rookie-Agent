/**
 * Terminal backend tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  TerminalBackendRegistry,
  LocalTerminalBackend,
  DockerTerminalBackend,
  SSHTerminalBackend,
  DaytonaTerminalBackend,
} from "../index.js";
import type { TerminalBackendOptions } from "../types.js";

describe("Terminal Backend Registry", () => {
  it("should register all backends", () => {
    const backends = TerminalBackendRegistry.list();
    expect(backends).toContain("local");
    expect(backends).toContain("docker");
    expect(backends).toContain("ssh");
    expect(backends).toContain("daytona");
  });

  it("should check if backend exists", () => {
    expect(TerminalBackendRegistry.has("local")).toBe(true);
    expect(TerminalBackendRegistry.has("unknown")).toBe(false);
  });
});

describe("Local Terminal Backend", () => {
  let backend: LocalTerminalBackend;

  beforeAll(async () => {
    backend = new LocalTerminalBackend();
    await backend.initialize();
  });

  afterAll(async () => {
    await backend.dispose();
  });

  it("should have correct metadata", () => {
    expect(backend.id).toBe("local");
    expect(backend.type).toBe("local");
    expect(backend.name).toBe("Local Shell");
  });

  it("should be available", async () => {
    const available = await backend.isAvailable();
    expect(available).toBe(true);
  });

  it("should get capabilities", async () => {
    const caps = await backend.getCapabilities();
    expect(caps.interactive).toBe(true);
    expect(caps.fileSystem).toBe(true);
    expect(caps.processManagement).toBe(true);
    expect(caps.environment).toBe(true);
    expect(caps.signals).toBe(true);
  });

  it("should execute a simple command", async () => {
    const result = await backend.execute("echo hello", { timeout: 5000 });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello");
    expect(result.timedOut).toBe(false);
  });

  it("should handle command failure", async () => {
    const result = await backend.execute("exit 42", { timeout: 5000 });
    expect(result.exitCode).toBe(42);
  });

  it("should handle timeout", async () => {
    const result = await backend.execute("sleep 10", { timeout: 100 });
    expect(result.timedOut).toBe(true);
  });

  it("should execute in specific directory", async () => {
    const result = await backend.execute("pwd", {
      cwd: "/tmp",
      timeout: 5000,
    });
    expect(result.stdout.trim()).toBe("/tmp");
  });

  it("should handle environment variables", async () => {
    const result = await backend.execute("echo $TEST_VAR", {
      env: { TEST_VAR: "test_value" },
      timeout: 5000,
    });
    expect(result.stdout.trim()).toBe("test_value");
  });

  it("should read and write files", async () => {
    const testPath = `/tmp/rookie_test_${Date.now()}.txt`;
    const testContent = "Hello from test!";

    await backend.writeFile(testPath, testContent);
    const read = await backend.readFile(testPath);
    expect(read).toBe(testContent);

    await backend.deleteFile(testPath);
    const exists = await backend.pathExists(testPath);
    expect(exists).toBe(false);
  });

  it("should list directory contents", async () => {
    const entries = await backend.listDirectory("/tmp");
    expect(Array.isArray(entries)).toBe(true);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("should get file info", async () => {
    const info = await backend.getFileInfo("/tmp");
    expect(info).not.toBeNull();
    expect(info?.type).toBe("directory");
  });

  it("should change directory", async () => {
    await backend.changeDirectory("/tmp");
    const cwd = await backend.getCurrentDirectory();
    expect(cwd).toBe("/tmp");
  });

  it("should resolve paths", async () => {
    const resolved = await backend.resolvePath("~");
    expect(resolved).not.toContain("~");
  });

  it("should handle background tasks", async () => {
    const taskId = await backend.executeBackground("sleep 1 && echo done", {
      timeout: 10000,
    });

    expect(taskId).toBeDefined();

    // Wait for task to complete
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const task = await backend.getBackgroundTask(taskId);
    expect(task).not.toBeNull();
    expect(task?.status).toBe("completed");
  });

  it("should detect read-only commands", () => {
    expect(backend.isReadOnly("ls -la")).toBe(true);
    expect(backend.isReadOnly("cat file.txt")).toBe(true);
    expect(backend.isReadOnly("git log")).toBe(true);
    expect(backend.isReadOnly("rm file.txt")).toBe(false);
  });
});

describe("Docker Terminal Backend", () => {
  it("should have correct metadata", () => {
    const options: TerminalBackendOptions = {
      config: {
        docker: {
          image: "alpine:latest",
        },
      },
    };
    const backend = new DockerTerminalBackend(options);
    expect(backend.type).toBe("docker");
  });

  it("should require docker image config", () => {
    expect(() => new DockerTerminalBackend({})).toThrow("docker.image");
  });

  it("should check docker availability", async () => {
    const options: TerminalBackendOptions = {
      config: {
        docker: {
          image: "alpine:latest",
        },
      },
    };
    const backend = new DockerTerminalBackend(options);
    // May or may not be available depending on environment
    const available = await backend.isAvailable();
    expect(typeof available).toBe("boolean");
  });
});

describe("SSH Terminal Backend", () => {
  it("should have correct metadata", () => {
    const options: TerminalBackendOptions = {
      config: {
        ssh: {
          host: "example.com",
          username: "user",
          auth: { type: "password", password: "pass" },
        },
      },
    };
    const backend = new SSHTerminalBackend(options);
    expect(backend.type).toBe("ssh");
    expect(backend.name).toContain("example.com");
  });

  it("should require ssh config", () => {
    expect(() => new SSHTerminalBackend({})).toThrow("ssh.host");
  });

  it("should get capabilities", async () => {
    const options: TerminalBackendOptions = {
      config: {
        ssh: {
          host: "example.com",
          username: "user",
          auth: { type: "password", password: "pass" },
        },
      },
    };
    const backend = new SSHTerminalBackend(options);
    const caps = await backend.getCapabilities();
    expect(caps.interactive).toBe(true);
    expect(caps.fileSystem).toBe(true);
  });
});

describe("Daytona Terminal Backend", () => {
  it("should have correct metadata", () => {
    const options: TerminalBackendOptions = {
      config: {
        daytona: {
          apiUrl: "https://api.daytona.io",
          apiKey: "test-key",
        },
      },
    };
    const backend = new DaytonaTerminalBackend(options);
    expect(backend.type).toBe("daytona");
  });

  it("should require daytona config", () => {
    expect(() => new DaytonaTerminalBackend({})).toThrow("daytona.apiUrl");
  });

  it("should get capabilities", async () => {
    const options: TerminalBackendOptions = {
      config: {
        daytona: {
          apiUrl: "https://api.daytona.io",
          apiKey: "test-key",
        },
      },
    };
    const backend = new DaytonaTerminalBackend(options);
    const caps = await backend.getCapabilities();
    expect(caps.interactive).toBe(true);
    expect(caps.fileSystem).toBe(true);
  });
});

describe("Terminal Backend Security", () => {
  it("should block dangerous commands", async () => {
    const backend = new LocalTerminalBackend();
    await backend.initialize();

    const result = await backend.execute("sudo rm -rf /", { timeout: 5000 });
    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("BLOCKED");

    await backend.dispose();
  });

  it("should respect output size limits", async () => {
    const backend = new LocalTerminalBackend({
      maxOutputSize: 100,
    });
    await backend.initialize();

    const result = await backend.execute("seq 1 1000", { timeout: 5000 });
    expect(result.output.length).toBeLessThan(200);
    expect(result.output).toContain("truncated");

    await backend.dispose();
  });
});
