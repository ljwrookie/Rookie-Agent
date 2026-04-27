// ─── TUI Theme System ────────────────────────────────────────────
// A3: Theme configuration with dark/light/high-contrast modes

export type ThemeName = "dark" | "light" | "high-contrast";

export interface ThemeColors {
  // Neutral
  text: string;
  textDim: string;
  border: string;
  background: string;
  // System
  system: string;
  link: string;
  // Feedback
  success: string;
  warning: string;
  error: string;
  fatal: string;
  // Accents
  user: string;
  assistant: string;
  toolName: string;
  modeBadge: string;
  // Special
  spinner: string;
  progressBar: string;
  progressTrack: string;
}

export interface Theme {
  name: ThemeName;
  colors: ThemeColors;
  symbols: {
    spinner: string[];
    progressFilled: string;
    progressEmpty: string;
    check: string;
    cross: string;
    warning: string;
    info: string;
    bullet: string;
  };
}

// Dark theme (default)
const darkTheme: Theme = {
  name: "dark",
  colors: {
    text: "white",
    textDim: "gray",
    border: "gray",
    background: "black",
    system: "cyan",
    link: "blue",
    success: "green",
    warning: "yellow",
    error: "red",
    fatal: "redBright",
    user: "green",
    assistant: "cyan",
    toolName: "magenta",
    modeBadge: "blueBright",
    spinner: "yellow",
    progressBar: "cyan",
    progressTrack: "gray",
  },
  symbols: {
    spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    progressFilled: "█",
    progressEmpty: "░",
    check: "✓",
    cross: "✗",
    warning: "⚠",
    info: "ℹ",
    bullet: "·",
  },
};

// Light theme
const lightTheme: Theme = {
  name: "light",
  colors: {
    text: "black",
    textDim: "gray",
    border: "gray",
    background: "white",
    system: "blue",
    link: "blueBright",
    success: "green",
    warning: "yellowBright",
    error: "red",
    fatal: "redBright",
    user: "green",
    assistant: "blue",
    toolName: "magenta",
    modeBadge: "cyan",
    spinner: "blue",
    progressBar: "blue",
    progressTrack: "gray",
  },
  symbols: {
    spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    progressFilled: "█",
    progressEmpty: "░",
    check: "✓",
    cross: "✗",
    warning: "⚠",
    info: "ℹ",
    bullet: "·",
  },
};

// High contrast theme (accessibility)
const highContrastTheme: Theme = {
  name: "high-contrast",
  colors: {
    text: "whiteBright",
    textDim: "white",
    border: "white",
    background: "black",
    system: "cyanBright",
    link: "blueBright",
    success: "greenBright",
    warning: "yellowBright",
    error: "redBright",
    fatal: "redBright",
    user: "greenBright",
    assistant: "cyanBright",
    toolName: "magentaBright",
    modeBadge: "blueBright",
    spinner: "yellowBright",
    progressBar: "greenBright",
    progressTrack: "white",
  },
  symbols: {
    spinner: [">", ">>", ">>>", ">>>>", ">>>>>", ">>>>", ">>>", ">>", ">"],
    progressFilled: "=",
    progressEmpty: "-",
    check: "[OK]",
    cross: "[ERR]",
    warning: "[!]",
    info: "[i]",
    bullet: "*",
  },
};

export const themes: Record<ThemeName, Theme> = {
  dark: darkTheme,
  light: lightTheme,
  "high-contrast": highContrastTheme,
};

// Default theme
export const defaultTheme: ThemeName = "dark";

// Get theme from environment or settings
export function getThemeFromEnv(): ThemeName {
  const envTheme = process.env.ROOKIE_THEME as ThemeName | undefined;
  if (envTheme && themes[envTheme]) {
    return envTheme;
  }
  return defaultTheme;
}

// Theme switching helper
export function getTheme(name?: ThemeName): Theme {
  return themes[name ?? getThemeFromEnv()] ?? themes[defaultTheme];
}
