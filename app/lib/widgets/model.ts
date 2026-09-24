import type { Recipe } from '../recipes';

export const WIDGET_SCHEMA = 1;
export const THEME_VERSION = 1;
export type Columns = 4 | 8 | 12;
export type WidgetSize = 'small' | 'standard' | 'wide' | 'tall' | 'focus';
export const SIZES: Record<WidgetSize, { w: number; h: number }> = {
  small: { w: 4, h: 2 },
  standard: { w: 4, h: 3 },
  wide: { w: 6, h: 3 },
  tall: { w: 4, h: 6 },
  focus: { w: 8, h: 6 },
};
export type NodeType =
  | 'text'
  | 'heading'
  | 'metric'
  | 'list'
  | 'checklist'
  | 'chart'
  | 'comparison'
  | 'steps'
  | 'columns'
  | 'callout';
export type LayoutNode = { id: string; type: NodeType; children: LayoutNode[] };
export type ContentValue = {
  text: string;
  label: string;
  value: string;
  items: { label: string; value: string }[];
};
export type Definition = {
  schema: 1;
  theme: 1;
  kind:
    | 'recipe'
    | 'library'
    | 'shopping'
    | 'calendar'
    | 'weather'
    | 'chores'
    | 'composition'
    | 'module'
    | 'page';
  tone: Tone;
  nodes: LayoutNode[];
  module?: { html: string; css: string; js: string };
  summary: string;
};
export type WidgetState = {
  stepId?: string;
  checked?: string[];
  custom?: Record<string, string | number | boolean>;
};
export type Placement = { x: number; y: number; w: number; h: number };
export type Layouts = Partial<Record<Columns, Placement>>;
export type Snapshot = {
  data: {
    content?: Record<string, ContentValue>;
    recipe?: Recipe;
    recipes?: Recipe[];
    items?: {
      id: string;
      text: string;
      category?: string;
      uid?: string;
      href?: string;
      etag?: string;
      remoteChecked?: boolean;
    }[];
    calendarEvents?: CalendarEvent[];
    calendarConnected?: boolean;
    calendarError?: string | null;
    weather?: Weather;
    weatherError?: string | null;
    chores?: { id: string; text: string; memberId?: string }[];
  };
  source: string;
  sources: { title: string; url: string }[];
  fetchedAt: string;
  staleAt: string | null;
  expiresAt: string | null;
};
// The fixed widget palette — widgets only ever pick from these tones.
// 'cream' stays as the light option; 'forest' remains valid for stored
// widgets and renders as the emerald gradient.
export const TONES = [
  'indigo',
  'sky',
  'green',
  'terracotta',
  'emerald',
  'amber',
  'violet',
  'cream',
  'forest',
] as const;
export type Tone = (typeof TONES)[number];
export const TONE_LABELS: Record<Tone, string> = {
  indigo: 'Indigo',
  sky: 'Sky',
  green: 'Green',
  terracotta: 'Terracotta',
  emerald: 'Emerald',
  amber: 'Amber',
  violet: 'Violet',
  cream: 'Light',
  forest: 'Forest',
};
// 'forest' is a legacy alias of emerald, so it is never offered as a pick.
export const PICKABLE_TONES: readonly Tone[] = TONES.filter(
  (t) => t !== 'forest',
);
export type Widget = {
  id: string;
  definitionId: string;
  previousDefinitionId: string | null;
  title: string;
  definition: Definition;
  snapshot: Snapshot;
  state: WidgetState;
  revision: number;
  pinned: boolean;
  archived: boolean;
  size: WidgetSize;
  order: number;
  layouts: Layouts;
  query: string;
  binding: { type: string; recipeUrl?: string; source?: string; tone?: Tone };
  offlineAllowed: boolean;
  updatedAt: string;
};
export type CalendarEvent = {
  id: string;
  calendarId: string;
  calendarName: string;
  calendarColor: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location?: string | null;
};
export type WeatherDay = {
  date: string;
  code: number;
  condition: string;
  high: number;
  low: number;
  rainChance: number;
};
export type Weather = {
  place: string;
  latitude: number;
  longitude: number;
  temperature: number;
  feelsLike: number;
  code: number;
  condition: string;
  isDay: boolean;
  windKmh: number;
  days: WeatherDay[];
};
/** WMO weather interpretation codes, as returned by Open-Meteo. */
export function weatherCondition(code: number) {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code === 61 || code === 80) return 'Light rain';
  if (code === 63 || code === 81) return 'Rain';
  if (code === 65 || code === 82) return 'Heavy rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code === 71 || code === 85) return 'Light snow';
  if (code === 73 || code === 75 || code === 86) return 'Snow';
  if (code === 77) return 'Snow grains';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm with hail';
  return 'Unknown';
}
export type FamilyMember = {
  id: string;
  name: string;
  color: string;
  emoji: string;
  calendarIds: string[];
};
export type Board = {
  widgets: Widget[];
  members: FamilyMember[];
  cacheScope: string;
  serverTime: string;
};
export function columnsForWidth(width: number): Columns {
  return width >= 900 ? 12 : width >= 600 ? 8 : 4;
}
export function normaliseQuery(query: string) {
  return query
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-AU')
    .replace(/\s+/g, ' ')
    .slice(0, 1200);
}
export function stepId(text: string) {
  let hash = 2166136261;
  for (const char of text.trim())
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `step-${(hash >>> 0).toString(36)}`;
}
export function safeUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const u = new URL(value);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !u.port &&
      !u.hostname.includes(':') &&
      !/^\d+(\.\d+){3}$/.test(u.hostname) &&
      u.hostname.includes('.') &&
      !/\.(localhost|local|internal)$/.test(u.hostname)
    );
  } catch {
    return false;
  }
}
export function validateState(input: unknown): WidgetState {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('Invalid widget state.');
  const state = input as WidgetState;
  if (
    Object.keys(state).some((k) => !['stepId', 'checked', 'custom'].includes(k))
  )
    throw Error('Unknown state field.');
  if (
    state.stepId !== undefined &&
    (typeof state.stepId !== 'string' || state.stepId.length > 100)
  )
    throw Error('Invalid cooking step.');
  if (
    state.checked !== undefined &&
    (!Array.isArray(state.checked) ||
      state.checked.length > 200 ||
      state.checked.some((x) => typeof x !== 'string' || x.length > 150))
  )
    throw Error('Invalid checklist.');
  if (state.custom !== undefined) {
    if (
      !state.custom ||
      typeof state.custom !== 'object' ||
      Array.isArray(state.custom) ||
      Object.keys(state.custom).length > 40
    )
      throw Error('Invalid custom state.');
    for (const [key, value] of Object.entries(state.custom)) {
      if (
        !/^[a-zA-Z][\w-]{0,60}$/.test(key) ||
        ['__proto__', 'constructor', 'prototype'].includes(key) ||
        !['string', 'number', 'boolean'].includes(typeof value) ||
        String(value).length > 500 ||
        (typeof value === 'number' && !Number.isFinite(value))
      )
        throw Error('Invalid custom value.');
    }
  }
  return JSON.parse(JSON.stringify(state));
}

/** Saved slots win. Only unplaced widgets are packed; pinned neighbours never move. */
export function packWidgets(
  widgets: Widget[],
  columns: Columns,
): Map<string, Placement> {
  const slots = new Map<string, Placement>();
  const occupied = new Set<string>();
  const fits = (p: Placement) =>
    p.x >= 0 &&
    p.y >= 0 &&
    p.x + p.w <= columns &&
    p.y <= 180 &&
    p.w >= 4 &&
    p.h >= 2 &&
    Array.from({ length: p.h }, (_, y) =>
      Array.from(
        { length: p.w },
        (_, x) => !occupied.has(`${p.x + x},${p.y + y}`),
      ),
    ).every((r) => r.every(Boolean));
  const place = (id: string, p: Placement) => {
    slots.set(id, p);
    for (let y = p.y; y < p.y + p.h; y++)
      for (let x = p.x; x < p.x + p.w; x++) occupied.add(`${x},${y}`);
  };
  const sorted = [...widgets].sort(
    (a, b) => a.order - b.order || a.id.localeCompare(b.id),
  );
  for (const widget of [...sorted].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned),
  )) {
    const saved = widget.layouts[columns];
    if (saved && Object.values(saved).every(Number.isInteger) && fits(saved))
      place(widget.id, saved);
  }
  for (const widget of sorted) {
    if (slots.has(widget.id)) continue;
    const size = SIZES[widget.size] ?? SIZES.standard;
    // A narrow container uses the actual compact variant, rather than scaling text.
    const w = Math.min(columns, size.w),
      h = size.h;
    let found = false;
    for (let y = 0; y <= 180 && !found; y++)
      for (let x = 0; x <= columns - w; x++) {
        const p = { x, y, w, h };
        if (fits(p)) {
          place(widget.id, p);
          found = true;
          break;
        }
      }
  }
  return slots;
}

export const ARTIFACT_TTL_MS = 24 * 3600e3;
export type Artifact = {
  id: string;
  title: string;
  query: string;
  definition: Definition;
  snapshot: Snapshot;
  state: WidgetState;
  promotedWidgetId: string | null;
  createdAt: string;
  expiresAt: string;
};
/** Synthetic widget so Composition/CustomWidget can render an artifact body. */
export function artifactAsWidget(a: Artifact): Widget {
  return {
    id: `artifact-${a.id}`,
    definitionId: a.id,
    title: a.title,
    definition: a.definition,
    snapshot: a.snapshot,
    state: a.state,
    revision: 0,
    pinned: false,
    archived: false,
    size: 'focus',
    order: 0,
    layouts: {},
    query: a.query,
    binding: { type: 'artifact' },
    offlineAllowed: false,
    updatedAt: a.createdAt,
    previousDefinitionId: null,
  };
}
export function relativeTime(iso: string, now = Date.now()): string {
  const t = new Date(iso).getTime();
  const diff = now - t;
  if (!Number.isFinite(t) || diff < 45e3) return 'just now';
  if (diff < 60 * 60e3) return `${Math.floor(diff / 60e3)} min ago`;
  if (diff < 24 * 3600e3) return `${Math.floor(diff / 3600e3)} h ago`;
  if (diff < 48 * 3600e3) return 'yesterday';
  if (diff < 14 * 86400e3) return `${Math.floor(diff / 86400e3)} days ago`;
  return new Date(t).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
  });
}
/** The user's persisted override wins over the definition's tone. */
export function widgetTone(
  widget: Pick<Widget, 'binding' | 'definition'>,
): Tone {
  return widget.binding.tone ?? widget.definition.tone;
}
export function isExpired(snapshot: Snapshot, now = Date.now()) {
  return !!snapshot.expiresAt && new Date(snapshot.expiresAt).getTime() <= now;
}
export function supportsSmall(widget: Widget) {
  const node = widget.definition.nodes[0];
  return (
    widget.definition.kind === 'composition' &&
    widget.definition.nodes.length === 1 &&
    node.type === 'metric' &&
    (widget.snapshot.data.content?.[node.id]?.value.length ?? 0) <= 18
  );
}
export function isStale(snapshot: Snapshot, now = Date.now()) {
  return !!snapshot.staleAt && new Date(snapshot.staleAt).getTime() <= now;
}
export function hasOwn(obj: object, key: string) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
