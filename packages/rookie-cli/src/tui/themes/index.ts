// ─── TUI Theme System ────────────────────────────────────────────
// A3: Theme configuration with dark/light/high-contrast modes
// Re-export from theme.ts for backward compatibility

export type { ThemeName, ThemeColors, Theme } from "../theme.js";
export { themes, defaultTheme, getThemeFromEnv, getTheme } from "../theme.js";
