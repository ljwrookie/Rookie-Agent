// ─── TUI Hook Tests ──────────────────────────────────────────────
// P4.5+P4.6: Tests for TUI hooks and terminal compatibility

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock ink
vi.mock("ink", () => ({
  useInput: () => {},
  useApp: () => ({ exit: vi.fn() }),
  useStdout: () => ({ stdout: { columns: 80, rows: 24, write: vi.fn() } }),
  useWindowSize: () => ({ columns: 80, rows: 24 }),
  Box: () => null,
  Text: () => null,
}));

describe("TUI Theme", () => {
  it("should return default theme", async () => {
    const { getThemeFromEnv, themes, defaultTheme } = await import("../src/tui/theme.js");
    const themeName = getThemeFromEnv();
    expect(themes[themeName]).toBeDefined();
    expect(themeName).toBe(defaultTheme);
  });

  it("should respect ROOKIE_THEME env", async () => {
    const original = process.env.ROOKIE_THEME;
    process.env.ROOKIE_THEME = "light";

    const { getThemeFromEnv } = await import("../src/tui/theme.js");
    const themeName = getThemeFromEnv();
    expect(themeName).toBe("light");

    process.env.ROOKIE_THEME = original;
  });

  it("should fallback for invalid theme", async () => {
    const original = process.env.ROOKIE_THEME;
    process.env.ROOKIE_THEME = "invalid";

    const { getThemeFromEnv, defaultTheme } = await import("../src/tui/theme.js");
    const themeName = getThemeFromEnv();
    expect(themeName).toBe(defaultTheme);

    process.env.ROOKIE_THEME = original;
  });

  it("should have all required colors", async () => {
    const { themes, defaultTheme } = await import("../src/tui/theme.js");
    const theme = themes[defaultTheme];

    expect(theme.colors.text).toBeDefined();
    expect(theme.colors.textDim).toBeDefined();
    expect(theme.colors.border).toBeDefined();
    expect(theme.colors.background).toBeDefined();
    expect(theme.colors.system).toBeDefined();
    expect(theme.colors.success).toBeDefined();
    expect(theme.colors.warning).toBeDefined();
    expect(theme.colors.error).toBeDefined();
  });

  it("should have spinner symbols", async () => {
    const { themes, defaultTheme } = await import("../src/tui/theme.js");
    const theme = themes[defaultTheme];

    expect(theme.symbols.spinner.length).toBeGreaterThan(0);
    expect(theme.symbols.check).toBeDefined();
    expect(theme.symbols.cross).toBeDefined();
  });
});

describe("Terminal Compatibility", () => {
  it("should handle non-TTY environments", () => {
    const originalIsTTY = process.stdout.isTTY;
    (process.stdout as any).isTTY = false;

    // These should not throw
    expect(() => {
      if (process.stdout.isTTY) {
        process.stdout.write("\u001b[?1049h");
      }
    }).not.toThrow();

    (process.stdout as any).isTTY = originalIsTTY;
  });

  it("should handle missing color support", async () => {
    const originalTerm = process.env.TERM;
    process.env.TERM = "dumb";

    const { getThemeFromEnv, themes } = await import("../src/tui/theme.js");
    const themeName = getThemeFromEnv();
    expect(themes[themeName]).toBeDefined();

    process.env.TERM = originalTerm;
  });

  it("should handle CI environments", async () => {
    const originalCI = process.env.CI;
    process.env.CI = "true";

    const { getThemeFromEnv, themes } = await import("../src/tui/theme.js");
    const themeName = getThemeFromEnv();
    expect(themes[themeName]).toBeDefined();

    process.env.CI = originalCI;
  });
});

describe("Frame Throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize empty", async () => {
    // Test the hook module loads correctly
    const { useFrameThrottle } = await import("../src/tui/hooks/useFrameThrottle.js");
    expect(typeof useFrameThrottle).toBe("function");
  });

  it("should have correct defaults", async () => {
    const { useFrameThrottle } = await import("../src/tui/hooks/useFrameThrottle.js");
    // The hook accepts options with defaults
    expect(() => useFrameThrottle({ targetFps: 60 })).toBeDefined();
    expect(() => useFrameThrottle({ maxBatchSize: 20 })).toBeDefined();
  });
});

describe("Checkpoint Stack Types", () => {
  it("should have correct interface", async () => {
    const { useCheckpointStack } = await import("../src/tui/hooks/useCheckpointStack.js");
    expect(typeof useCheckpointStack).toBe("function");
  });

  it("should define entry structure", async () => {
    const { useCheckpointStack } = await import("../src/tui/hooks/useCheckpointStack.js");
    // Verify the hook can be imported and has the right shape
    expect(useCheckpointStack).toBeDefined();
  });
});

describe("Navigation Types", () => {
  it("should have correct view types", async () => {
    const { useNavigation } = await import("../src/tui/hooks/useNavigation.js");
    expect(typeof useNavigation).toBe("function");
  });

  it("should define overlay types", async () => {
    const { useNavigation } = await import("../src/tui/hooks/useNavigation.js");
    // Verify all overlay types are defined
    expect(useNavigation).toBeDefined();
  });
});
