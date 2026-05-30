/* ============================================================
   utils/themeManager.ts — Centralised theme management
   Persists theme preference to browser.storage.local and
   syncs the `data-theme` attribute on the document root.
   Used by all UI surfaces (overlay, popup, onboarding).
   ============================================================ */

import browser from "webextension-polyfill";

export type Theme = "dark" | "light";

const THEME_STORAGE_KEY = "mindease_theme";

/* ── Listeners ── */
type ThemeListener = (theme: Theme) => void;
const listeners: Set<ThemeListener> = new Set();

export function onThemeChange(fn: ThemeListener): void {
  listeners.add(fn);
}

export function offThemeChange(fn: ThemeListener): void {
  listeners.delete(fn);
}

function notify(theme: Theme): void {
  for (const fn of listeners) fn(theme);
}

/* ── Apply theme to DOM ── */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function getAppliedTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "light") return "light";
  return "dark";
}

/* ── Persistence ── */
export async function saveTheme(theme: Theme): Promise<void> {
  try {
    await browser.storage.local.set({ [THEME_STORAGE_KEY]: theme });
  } catch {
    // Fallback to localStorage for environments where
    // browser.storage is not available (e.g. onboarding
    // opened as standalone tab without extension context).
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

export async function loadTheme(): Promise<Theme> {
  try {
    const result = await browser.storage.local.get(THEME_STORAGE_KEY);
    if (result[THEME_STORAGE_KEY] === "light" || result[THEME_STORAGE_KEY] === "dark") {
      return result[THEME_STORAGE_KEY] as Theme;
    }
  } catch {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  }
  // Fall back to system preference
  if (window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

/* ── Toggle ── */
export async function toggleTheme(): Promise<Theme> {
  const current = getAppliedTheme();
  const next: Theme = current === "dark" ? "light" : "dark";
  applyTheme(next);
  await saveTheme(next);
  notify(next);
  return next;
}

/* ── One-shot init — apply persisted then listen for system changes ── */
export async function initTheme(): Promise<Theme> {
  const theme = await loadTheme();
  applyTheme(theme);

  // Listen for system preference changes
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", async (e) => {
    // Only auto-switch if user hasn't explicitly set a preference
    const stored = await loadTheme();
    const system: Theme = e.matches ? "light" : "dark";
    if (stored === system) return; // Already in sync
    applyTheme(system);
    notify(system);
  });

  return theme;
}
