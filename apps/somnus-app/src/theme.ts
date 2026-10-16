/**
 * Appearance: the brand's dark look, a light one (dark text on light), or high
 * contrast. A per-device preference, so it lives in localStorage -- it is not
 * account data, and nothing breaks without it (private windows, blocked
 * storage): the page simply stays dark.
 */
export const THEMES = ["dark", "light", "contrast"] as const;
export type Theme = (typeof THEMES)[number];

const STORAGE_KEY = "somnus_theme";

function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === "dark") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable: the choice holds for this visit only */
  }
}
