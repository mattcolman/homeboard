'use client';
import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';
export const STORAGE_KEY = 'homeboard-theme';

const listeners = new Set<() => void>();
let media: MediaQueryList | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

export function readTheme(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
}

export function setTheme(theme: Theme) {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable; still apply for this session.
  }
  applyTheme(theme);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!media) {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => {
      applyTheme(readTheme());
      notify();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(
    subscribe,
    readTheme,
    () => 'system' as Theme,
  );
  const resolved = useSyncExternalStore(
    subscribe,
    () => resolveTheme(readTheme()),
    () => 'light' as const,
  );
  return { theme, resolved, setTheme };
}
