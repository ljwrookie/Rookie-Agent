// A3: Theme context hook for TUI
// Provides theme state and switching functionality

import React, { createContext, useContext, useState, useCallback } from "react";
import type { ThemeName, Theme } from "../theme.js";
import { themes, getThemeFromEnv } from "../theme.js";

interface ThemeContextValue {
  themeName: ThemeName;
  theme: Theme;
  setTheme: (name: ThemeName) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  initialTheme?: ThemeName;
}

export function ThemeProvider({ children, initialTheme }: ThemeProviderProps) {
  const [themeName, setThemeName] = useState<ThemeName>(initialTheme ?? getThemeFromEnv());

  const setTheme = useCallback((name: ThemeName) => {
    if (themes[name]) {
      setThemeName(name);
      // FIX #1: Removed localStorage persistence - Node CLI has no localStorage
      // Theme persistence should be implemented via file-based settings
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const themeOrder: ThemeName[] = ["dark", "light", "high-contrast"];
    const currentIndex = themeOrder.indexOf(themeName);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    setTheme(themeOrder[nextIndex]);
  }, [themeName, setTheme]);

  // FIX #1: Removed localStorage load on mount - Node CLI has no localStorage
  // Theme initialization is done via getThemeFromEnv() above

  const value: ThemeContextValue = {
    themeName,
    theme: themes[themeName],
    setTheme,
    toggleTheme,
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}
