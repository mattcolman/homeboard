'use client';
import { MonitorSmartphone, Moon, Sun } from 'lucide-react';
import { useTheme, type Theme } from '../lib/theme';

const NEXT: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};
const ICONS = { light: Sun, dark: Moon, system: MonitorSmartphone };

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = NEXT[theme];
  const Icon = ICONS[theme];
  const label = `Theme: ${theme} (switch to ${next})`;
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      <Icon />
    </button>
  );
}
