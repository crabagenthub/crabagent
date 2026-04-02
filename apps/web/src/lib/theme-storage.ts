export const CA_THEME_STORAGE_KEY = "ca-theme";

export type ThemePreference = "light" | "dark" | "system";

const VALID: ThemePreference[] = ["light", "dark", "system"];

export function parseThemePreference(raw: string | null | undefined): ThemePreference {
  if (raw && VALID.includes(raw as ThemePreference)) {
    return raw as ThemePreference;
  }
  return "system";
}

/** Client-only: read from localStorage. */
export function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    return parseThemePreference(window.localStorage.getItem(CA_THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Client-only: persist preference (light / dark / system). */
export function writeStoredTheme(pref: ThemePreference): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(CA_THEME_STORAGE_KEY, pref);
  } catch {
    /* ignore */
  }
}

export function resolveDark(pref: ThemePreference, prefersDark: boolean): boolean {
  if (pref === "dark") {
    return true;
  }
  if (pref === "light") {
    return false;
  }
  return prefersDark;
}
