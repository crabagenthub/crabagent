"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  readStoredTheme,
  resolveDark,
  writeStoredTheme,
  type ThemePreference,
} from "@/lib/theme-storage";

type ThemeContextValue = {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  resolvedDark: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getPrefersDark(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Sync Tailwind/shadcn (`html.dark`) and Arco (`body[arco-theme]`). */
export function applyThemeToDocument(isDark: boolean): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.classList.toggle("dark", isDark);
  const body = document.body;
  if (!body) {
    return;
  }
  if (isDark) {
    body.setAttribute("arco-theme", "dark");
  } else {
    body.removeAttribute("arco-theme");
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolvedDark, setResolvedDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useLayoutEffect(() => {
    const stored = readStoredTheme();
    setPreferenceState(stored);
    const dark = resolveDark(stored, getPrefersDark());
    setResolvedDark(dark);
    applyThemeToDocument(dark);
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!mounted || preference !== "system") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const dark = resolveDark("system", mq.matches);
      setResolvedDark(dark);
      applyThemeToDocument(dark);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference, mounted]);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    writeStoredTheme(p);
    const dark = resolveDark(p, getPrefersDark());
    setResolvedDark(dark);
    applyThemeToDocument(dark);
  }, []);

  const value = useMemo(
    () => ({ preference, setPreference, resolvedDark }),
    [preference, setPreference, resolvedDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
