// ─── Theme Hook ──────────────────────────────────────────────────
// A3: React hook for theme management with persistence

import { useState, useCallback, useEffect } from "react";
import type { ThemeName, Theme } from "../theme.js";
import { getTheme, themes, defaultTheme } from "../theme.js";

const THEME_STORAGE_KEY = "rookie:theme";

export interface UseThemeReturn {
  theme: Theme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
  cycleTheme: () => void;
  availableThemes: ThemeName[];
}

export function useTheme(): UseThemeReturn {
  // Initialize from localStorage or environment
  const [themeName, setThemeNameState] = useState<ThemeName>(() => {
    if (typeof process !== "undefined" && process.env.ROOKIE_THEME) {
      const envTheme = process.env.ROOKIE_THEME as ThemeName;
      if (themes[envTheme]) return envTheme;
    }
    // Note: In actual implementation, would read from settings file
    // For now, use environment or default
    return defaultTheme;
  });

  const theme = getTheme(themeName);

  const setTheme = useCallback((name: ThemeName) => {
    if (themes[name]) {
      setThemeNameState(name);
      // Persist to settings would happen here
    }
  }, []);

  const cycleTheme = useCallback(() => {
    const themeList: ThemeName[] = ["dark", "light", "high-contrast"];
    const currentIndex = themeList.indexOf(themeName);
    const nextIndex = (currentIndex + 1) % themeList.length;
    setTheme(themeList[nextIndex]);
  }, [themeName, setTheme]);

  // Sync with environment variable changes (for HMR/debugging)
  useEffect(() => {
    const handleEnvChange = () => {
      const envTheme = process.env.ROOKIE_THEME as ThemeName | undefined;
      if (envTheme && themes[envTheme] && envTheme !== themeName) {
        setThemeNameState(envTheme);
      }
    };
    // Check on mount
    handleEnvChange();
  }, [themeName]);

  return {
    theme,
    themeName,
    setTheme,
    cycleTheme,
    availableThemes: Object.keys(themes) as ThemeName[],
  };
}
