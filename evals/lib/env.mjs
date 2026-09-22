// Minimal env loading for the eval harness — no dependencies.
// Precedence: process.env > evals/.env > repo .env.local.
import { existsSync, readFileSync } from 'node:fs';

const FILES = [
  new URL('../.env', import.meta.url),
  new URL('../../.env.local', import.meta.url),
];

const loaded = {};
for (const file of FILES) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (key in process.env || key in loaded) continue;
    loaded[key] = raw.replace(/^["']|["']$/g, '').trim();
  }
}

export function env(key, fallback) {
  return process.env[key] ?? loaded[key] ?? fallback;
}

export function requireEnv(key) {
  const value = env(key);
  if (!value)
    throw Error(
      `Missing ${key} — set it in evals/.env or the repo .env.local.`,
    );
  return value;
}
