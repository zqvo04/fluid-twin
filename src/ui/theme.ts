/**
 * Light/dark theme persistence. `system` (the default) removes the manual
 * override and lets tokens.css's prefers-color-scheme media query decide;
 * an explicit choice stamps data-theme on <html>, which tokens.css's
 * :root[data-theme] rules — and render/theme.ts's canvas colors — read.
 */

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'fluidtwin-theme';

export function getStoredTheme(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'system';
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' ? v : 'system';
}

export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  if (mode === 'system') {
    root.removeAttribute('data-theme');
    localStorage.removeItem(STORAGE_KEY);
  } else {
    root.setAttribute('data-theme', mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }
}

export function initTheme(): void {
  if (typeof document === 'undefined') return;
  applyTheme(getStoredTheme());
}

export function nextTheme(current: ThemeMode): ThemeMode {
  if (current === 'system') return 'light';
  if (current === 'light') return 'dark';
  return 'system';
}
