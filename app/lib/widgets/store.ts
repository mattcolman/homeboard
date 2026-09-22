import { env } from 'cloudflare:workers';
import { listRecipes, saveRecipe } from '../db';
import {
  calendarSnapshot,
  deleteShoppingItem,
  shoppingConnection,
  syncShoppingItems,
} from '../calendar/icloud';
import { generateWidget } from './generation';
import { curateForShopping, type CuratedItem } from './curate-shopping';
import { listMembers } from '../family';
import { weatherPlace, weatherSnapshot } from '../weather';
import {
  isExpired,
  isStale,
  normaliseQuery,
  packWidgets,
  SIZES,
  stepId,
  supportsSmall,
  validateState,
  type Board,
  type Columns,
  type Definition,
  type LayoutNode,
  type Snapshot,
  type Tone,
  type Widget,
  type WidgetSize,
  type WidgetState,
} from './model';

const db = () => (env as unknown as { DB: D1Database }).DB;
// Bound widgets wear their kind's palette tone; ingest widgets colour by
// source (golf → emerald) and other pushed cards default to violet. The
// calendar stays cream so the agenda matches the full-screen calendar.
const BOUND_TONES: Record<string, Tone> = {
  calendar: 'cream',
  weather: 'sky',
  shopping: 'green',
  chores: 'amber',
  library: 'terracotta',
  example: 'violet',
};
const INGEST_TONES: Record<string, Tone> = { golf: 'emerald' };
export class WidgetError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function ownerFor(request: Request) {
  const local =
    process.env.NODE_ENV === 'development' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname);
  // Eval isolation: a separate board owner per scenario run. Dev-only, like
  // the local fallback below — the sites runtime strips spoofable auth
  // headers in production so this can never fire there.
  const evalOwner = local
    ? request.headers.get('x-homeboard-eval-owner')
    : null;
  if (evalOwner && /^[\w.-]{1,150}$/.test(evalOwner)) return evalOwner;
  const owner = request.headers.get('oai-authenticated-user-id');
  if (owner) return owner;
  if (local) return 'homeboard-local-development';
  throw new WidgetError('Sign in to open your Homeboard.', 401);
}
export function assertMutationOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new WidgetError('This request did not come from Homeboard.', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new WidgetError('This request did not come from Homeboard.', 403);
}
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
type Row = {
  id: string;
  definition_id: string;
  previous_definition_id: string | null;
  spec_json: string;
  title: string;
  query_text: string;
  binding_json: string;
  state_json: string;
  revision: number;
  pinned: number;
  archived: number;
  offline_allowed: number;
  size: WidgetSize;
  updated_at: string;
  snapshot_json: string;
  layouts_json: string;
  ordinal: number;
  previous_json: string | null;
};
const SELECT = `SELECT i.*,d.spec_json,s.snapshot_json,p.layouts_json,p.ordinal FROM widget_instances i JOIN widget_definitions d ON d.id=i.definition_id AND d.owner_id=i.owner_id JOIN widget_snapshots s ON s.instance_id=i.id JOIN widget_placements p ON p.instance_id=i.id`;
function fromRow(r: Row): Widget {
  return {
    id: r.id,
    definitionId: r.definition_id,
    previousDefinitionId: r.previous_definition_id,
    title: r.title,
    definition: JSON.parse(r.spec_json),
    snapshot: JSON.parse(r.snapshot_json),
    state: JSON.parse(r.state_json),
    revision: r.revision,
    pinned: !!r.pinned,
    archived: !!r.archived,
    offlineAllowed: !!r.offline_allowed,
    size: r.size,
    order: r.ordinal,
    layouts: JSON.parse(r.layouts_json),
    query: r.query_text,
    binding: JSON.parse(r.binding_json),
    updatedAt: r.updated_at,
  };
}
export async function getWidget(owner: string, id: string) {
  const r = await db()
    .prepare(`${SELECT} WHERE i.owner_id=? AND i.id=?`)
    .bind(owner, id)
    .first<Row>();
  if (!r) throw new WidgetError('That widget is no longer available.', 404);
  return fromRow(r);
}
async function allWidgets(owner: string, includeArchived = false) {
  const r = await db()
    .prepare(
      `${SELECT} WHERE i.owner_id=? ${includeArchived ? '' : 'AND i.archived=0'} ORDER BY p.ordinal,i.created_at LIMIT 40`,
    )
    .bind(owner)
    .all<Row>();
  return r.results.map(fromRow);
}
const emptySnapshot = (
  source: string,
  data: Snapshot['data'] = {},
): Snapshot => ({
  data,
  source,
  sources: [],
  fetchedAt: new Date().toISOString(),
  staleAt: null,
  expiresAt: null,
});
const baseDefinition = (
  kind: Definition['kind'],
  tone: Definition['tone'] = 'cream',
): Definition => ({ schema: 1, theme: 1, kind, tone, nodes: [], summary: '' });

export async function createWidget(
  owner: string,
  input: {
    id?: string;
    title: string;
    definition: Definition;
    snapshot: Snapshot;
    query?: string;
    binding?: Widget['binding'];
    size?: WidgetSize;
    pinned?: boolean;
    offlineAllowed?: boolean;
    state?: WidgetState;
  },
) {
  const id = input.id ?? crypto.randomUUID(),
    now = new Date().toISOString();
  const definitionId = await hash(owner + JSON.stringify(input.definition)),
    existing = await allWidgets(owner);
  if (existing.length >= 30 && !input.id)
    throw new WidgetError(
      'Your board has 30 widgets. Remove one before adding another.',
    );
  const widget: Widget = {
    id,
    definitionId,
    previousDefinitionId: null,
    title: input.title,
    definition: input.definition,
    snapshot: input.snapshot,
    state: input.state ?? {},
    revision: 0,
    pinned: input.pinned ?? false,
    archived: false,
    offlineAllowed: input.offlineAllowed ?? false,
    size: input.size ?? 'standard',
    order: existing.length ? Math.max(...existing.map((w) => w.order)) + 1 : 0,
    layouts: {},
    query: input.query ?? '',
    binding: input.binding ?? { type: 'generated' },
    updatedAt: now,
  };
  for (const columns of [4, 8, 12] as Columns[])
    widget.layouts[columns] = packWidgets([...existing, widget], columns).get(
      id,
    );
  await db().batch([
    db()
      .prepare(
        'INSERT OR IGNORE INTO widget_definitions(id,owner_id,spec_json,created_at) VALUES(?,?,?,?)',
      )
      .bind(definitionId, owner, JSON.stringify(input.definition), now),
    db()
      .prepare(
        'INSERT OR IGNORE INTO widget_instances(id,owner_id,definition_id,title,query_key,query_text,binding_json,state_json,pinned,offline_allowed,size,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        owner,
        definitionId,
        input.title,
        normaliseQuery(input.query ?? ''),
        input.query ?? '',
        JSON.stringify(widget.binding),
        JSON.stringify(widget.state),
        Number(widget.pinned),
        Number(widget.offlineAllowed),
        widget.size,
        now,
        now,
      ),
    db()
      .prepare(
        'INSERT OR IGNORE INTO widget_snapshots(instance_id,snapshot_json) VALUES(?,?)',
      )
      .bind(id, JSON.stringify(input.snapshot)),
    db()
      .prepare(
        'INSERT OR IGNORE INTO widget_placements(instance_id,layouts_json,ordinal) VALUES(?,?,?)',
      )
      .bind(id, JSON.stringify(widget.layouts), widget.order),
  ]);
  return getWidget(owner, id);
}

export async function loadBoard(
  owner: string,
  request?: Request,
): Promise<Board> {
  const count = await db()
    .prepare('SELECT COUNT(*) AS count FROM widget_instances WHERE owner_id=?')
    .bind(owner)
    .first<{ count: number }>();
  const scope = await hash(owner);
  if (!count?.count) {
    const recipes = await listRecipes();
    const make = async (
      name: string,
      title: string,
      definition: Definition,
      snapshot: Snapshot,
      size: WidgetSize = 'standard',
      binding: Widget['binding'] = { type: 'example' },
    ) =>
      createWidget(owner, {
        id: `initial-${scope.slice(0, 20)}-${name}`,
        title,
        definition,
        snapshot,
        size,
        pinned: true,
        binding,
      });
    await make(
      'agenda',
      'Everyone’s day',
      baseDefinition('calendar'),
      await calendarSnapshot(owner),
      'tall',
      { type: 'calendar' },
    );
    await make(
      'weather',
      'Weather',
      baseDefinition('weather', 'sky'),
      await weatherSnapshot(weatherPlace(request)),
      'standard',
      { type: 'weather' },
    );
    await make(
      'recipes',
      'Recipes',
      baseDefinition('library', 'terracotta'),
      emptySnapshot('Saved recipes', { recipes }),
      'standard',
      { type: 'library' },
    );
    await make(
      'spending',
      'Monthly spending',
      {
        ...baseDefinition('composition', 'violet'),
        nodes: [{ id: 'spending', type: 'chart', children: [] }],
        summary: 'Example spending, not connected to an account.',
      },
      emptySnapshot('Example spending', {
        content: {
          spending: {
            text: 'Illustrative household budget',
            label: 'Dollars',
            value: '',
            items: [
              { label: 'Home', value: '2410' },
              { label: 'Food', value: '1362' },
              { label: 'Kids', value: '1084' },
              { label: 'Other', value: '1428' },
            ],
          },
        },
      }),
    );
    await make(
      'shopping',
      'Shopping',
      baseDefinition('shopping', 'green'),
      emptySnapshot('Your shopping list', { items: [] }),
      'standard',
      { type: 'shopping' },
    );
    await make(
      'chores',
      'Chores',
      baseDefinition('chores', 'amber'),
      emptySnapshot('Household chores', { chores: [] }),
      'standard',
      { type: 'chores' },
    );
    await make(
      'welcome',
      'Make room for an idea',
      {
        ...baseDefinition('composition', 'violet'),
        nodes: [{ id: 'hello', type: 'text', children: [] }],
        summary: 'Ask Homeboard to make something useful.',
      },
      emptySnapshot('Homeboard', {
        content: {
          hello: {
            text: '“Compare trees for the backyard.”\n\n“Explain how the seasons work.”\n\n“Make a checklist for the weekend.”',
            label: '',
            value: '',
            items: [],
          },
        },
      }),
    );
  }
  const widgets = await allWidgets(owner),
    recipes = await listRecipes();
  // Boards created before the weather widget existed get one too — unless the
  // household already removed it (an archived copy still counts as known).
  // Migrated widgets reuse the seeded deterministic id so a concurrent
  // loadBoard in another tab cannot create a duplicate.
  for (const [bindingType, id, make] of [
    [
      'weather',
      `initial-${scope.slice(0, 20)}-weather`,
      async () => ({
        title: 'Weather',
        definition: baseDefinition('weather', 'sky'),
        snapshot: await weatherSnapshot(weatherPlace(request)),
      }),
    ],
    [
      'chores',
      `initial-${scope.slice(0, 20)}-chores`,
      async () => ({
        title: 'Chores',
        definition: baseDefinition('chores', 'amber'),
        snapshot: emptySnapshot('Household chores', { chores: [] }),
      }),
    ],
  ] as const) {
    if (widgets.some((w) => w.binding.type === bindingType)) continue;
    const known = await db()
      .prepare(
        `SELECT 1 FROM widget_instances WHERE owner_id=? AND binding_json LIKE ? LIMIT 1`,
      )
      .bind(owner, `%"type":"${bindingType}"%`)
      .first();
    if (known) continue;
    try {
      widgets.push(
        await createWidget(owner, {
          ...(await make()),
          id,
          size: 'standard',
          pinned: true,
          binding: { type: bindingType },
        }),
      );
    } catch (error) {
      // A concurrent loadBoard won the insert; the widget is already there.
      const existing = await getWidget(owner, id).catch(() => null);
      if (existing) widgets.push(existing);
      else throw error;
    }
  }
  for (let i = 0; i < widgets.length; i++) {
    let widget = widgets[i];
    const wantedTone =
      BOUND_TONES[widget.binding.type] ??
      (widget.binding.type === 'ingest'
        ? (INGEST_TONES[widget.binding.source ?? ''] ?? 'violet')
        : undefined);
    if (wantedTone && widget.definition.tone !== wantedTone) {
      try {
        widgets[i] = widget = await write(
          owner,
          widget,
          { definition: { ...widget.definition, tone: wantedTone } },
          crypto.randomUUID(),
          false,
        );
      } catch (error) {
        if (!(error instanceof WidgetError) || error.status !== 409)
          throw error;
        widgets[i] = widget = await getWidget(owner, widget.id);
      }
    }
    if (
      widget.title === 'Everyone’s day' &&
      widget.binding.type !== 'calendar'
    ) {
      try {
        widgets[i] = await write(
          owner,
          widget,
          {
            definition: baseDefinition('calendar'),
            snapshot: await calendarSnapshot(owner, 'if-stale'),
            binding: { type: 'calendar' },
          },
          crypto.randomUUID(),
          false,
        );
      } catch (error) {
        if (!(error instanceof WidgetError) || error.status !== 409)
          throw error;
        widgets[i] = await getWidget(owner, widget.id);
      }
      continue;
    }
    if (widget.binding.type === 'calendar') {
      const snapshot = await calendarSnapshot(owner, 'if-stale');
      if (JSON.stringify(widget.snapshot) !== JSON.stringify(snapshot)) {
        try {
          widgets[i] = await write(
            owner,
            widget,
            { snapshot },
            crypto.randomUUID(),
            false,
          );
        } catch (error) {
          if (!(error instanceof WidgetError) || error.status !== 409)
            throw error;
          widgets[i] = await getWidget(owner, widget.id);
        }
      }
      continue;
    }
    if (widget.binding.type === 'shopping') {
      widgets[i] = await syncShopping(owner, widget, false);
      continue;
    }
    if (widget.binding.type === 'weather') {
      widgets[i] = await syncWeather(owner, widget, false, request);
      continue;
    }
    if (widget.binding.type === 'library') {
      const changes: Changes = {};
      if (widget.title === 'Family favourites') changes.title = 'Recipes';
      if (
        JSON.stringify(widget.snapshot.data.recipes) !==
        JSON.stringify(recipes)
      )
        changes.snapshot = emptySnapshot('Saved recipes', { recipes });
      if (Object.keys(changes).length) {
        try {
          widgets[i] = await write(
            owner,
            widget,
            changes,
            crypto.randomUUID(),
            false,
          );
        } catch (error) {
          if (!(error instanceof WidgetError) || error.status !== 409)
            throw error;
          widgets[i] = await getWidget(owner, widget.id);
        }
      }
    }
  }
  const members = await listMembers(owner);
  return {
    widgets,
    members,
    cacheScope: scope,
    serverTime: new Date().toISOString(),
  };
}

type Changes = Partial<
  Pick<
    Widget,
    | 'title'
    | 'definition'
    | 'snapshot'
    | 'state'
    | 'pinned'
    | 'archived'
    | 'size'
    | 'layouts'
    | 'offlineAllowed'
    | 'previousDefinitionId'
    | 'binding'
  >
>;
async function write(
  owner: string,
  current: Widget,
  changes: Changes,
  mutationId: string,
  remember: boolean | 'consume' = true,
) {
  const seen = await db()
    .prepare(
      'SELECT id FROM widget_mutations WHERE id=? AND owner_id=? AND instance_id=?',
    )
    .bind(mutationId, owner, current.id)
    .first();
  if (seen) return getWidget(owner, current.id);
  const next = { ...current, ...changes },
    now = new Date().toISOString();
  const definitionId = changes.definition
    ? await hash(owner + JSON.stringify(changes.definition))
    : current.definitionId;
  next.previousDefinitionId =
    changes.previousDefinitionId !== undefined
      ? changes.previousDefinitionId
      : changes.definition && definitionId !== current.definitionId
        ? current.definitionId
        : current.previousDefinitionId;
  const before =
    remember === true
      ? JSON.stringify({
          title: current.title,
          definition: current.definition,
          snapshot: current.snapshot,
          state: current.state,
          pinned: current.pinned,
          archived: current.archived,
          size: current.size,
          layouts: current.layouts,
          offlineAllowed: current.offlineAllowed,
          binding: current.binding,
          previousDefinitionId: current.previousDefinitionId,
        })
      : null;
  const match =
    'SELECT 1 FROM widget_instances WHERE id=? AND owner_id=? AND last_mutation_id=?';
  const results = await db().batch([
    db()
      .prepare(
        'INSERT OR IGNORE INTO widget_definitions(id,owner_id,spec_json,created_at) VALUES(?,?,?,?)',
      )
      .bind(definitionId, owner, JSON.stringify(next.definition), now),
    db()
      .prepare(
        'UPDATE widget_instances SET definition_id=?,previous_definition_id=?,title=?,binding_json=?,state_json=?,pinned=?,archived=?,offline_allowed=?,size=?,revision=revision+1,last_mutation_id=?,previous_json=CASE WHEN ? THEN ? ELSE previous_json END,updated_at=? WHERE id=? AND owner_id=? AND revision=?',
      )
      .bind(
        definitionId,
        next.previousDefinitionId,
        next.title,
        JSON.stringify(next.binding),
        JSON.stringify(next.state),
        Number(next.pinned),
        Number(next.archived),
        Number(next.offlineAllowed),
        next.size,
        mutationId,
        Number(remember !== false),
        before,
        now,
        current.id,
        owner,
        current.revision,
      ),
    db()
      .prepare(
        `UPDATE widget_snapshots SET snapshot_json=? WHERE instance_id=? AND EXISTS(${match})`,
      )
      .bind(
        JSON.stringify(next.snapshot),
        current.id,
        current.id,
        owner,
        mutationId,
      ),
    db()
      .prepare(
        `UPDATE widget_placements SET layouts_json=? WHERE instance_id=? AND EXISTS(${match})`,
      )
      .bind(
        JSON.stringify(next.layouts),
        current.id,
        current.id,
        owner,
        mutationId,
      ),
    db()
      .prepare(
        `INSERT OR IGNORE INTO widget_mutations(id,owner_id,instance_id,created_at) SELECT ?,?,?,? WHERE EXISTS(${match})`,
      )
      .bind(mutationId, owner, current.id, now, current.id, owner, mutationId),
  ]);
  if (!results[1].meta.changes)
    throw new WidgetError(
      'This widget changed on another screen. It has been reloaded; please try again.',
      409,
    );
  return getWidget(owner, current.id);
}

const resolving = new Map<
  string,
  Promise<{ widget: Widget; reused: boolean }>
>();
export async function resolveWidget(owner: string, query: string) {
  const key = owner + '\n' + normaliseQuery(query);
  const pending = resolving.get(key);
  if (pending) return pending;
  const promise = resolveUncached(owner, query);
  resolving.set(key, promise);
  try {
    return await promise;
  } finally {
    resolving.delete(key);
  }
}
async function resolveUncached(owner: string, query: string) {
  if (!query.trim() || query.length > 1200)
    throw new WidgetError('Ask for a short, specific widget.');
  const row = await db()
    .prepare(
      `${SELECT} WHERE i.owner_id=? AND i.query_key=? AND i.archived=0 ORDER BY i.updated_at DESC LIMIT 1`,
    )
    .bind(owner, normaliseQuery(query))
    .first<Row>();
  if (row) {
    const widget = fromRow(row);
    if (!isExpired(widget.snapshot)) return { widget, reused: true };
    return {
      widget: await refreshWidget(owner, widget, crypto.randomUUID()),
      reused: true,
    };
  }
  const generated = await generateWidget(query);
  return {
    widget: await createWidget(owner, {
      ...generated,
      query,
      size: generated.definition.kind === 'module' ? 'wide' : 'standard',
    }),
    reused: false,
  };
}
export async function recipeWidget(
  owner: string,
  recipeUrl: string,
  recipe?: import('../recipes').Recipe,
) {
  if (recipe && recipe.canonicalUrl !== recipeUrl)
    throw new WidgetError('The recipe does not match its source.');
  const existing = (await allWidgets(owner)).find(
    (w) => w.binding.type === 'recipe' && w.binding.recipeUrl === recipeUrl,
  );
  if (existing) return existing;
  const selected =
    recipe ?? (await listRecipes()).find((r) => r.canonicalUrl === recipeUrl);
  if (!selected)
    throw new WidgetError('That saved recipe could not be found.', 404);
  const snapshot = emptySnapshot(selected.sourceName, { recipe: selected });
  snapshot.sources = [
    { title: selected.sourceName, url: selected.canonicalUrl },
  ];
  return createWidget(owner, {
    title: selected.title,
    definition: baseDefinition('recipe', 'terracotta'),
    snapshot,
    binding: { type: 'recipe', recipeUrl },
    state: { stepId: stepId(selected.steps[0] ?? '') },
    size: 'standard',
  });
}
async function refreshWidget(
  owner: string,
  current: Widget,
  mutationId: string,
) {
  if (current.binding.type === 'library')
    return write(
      owner,
      current,
      {
        snapshot: emptySnapshot('Saved recipes', {
          recipes: await listRecipes(),
        }),
      },
      mutationId,
      false,
    );
  if (current.binding.type === 'calendar')
    return write(
      owner,
      current,
      { snapshot: await calendarSnapshot(owner, 'always') },
      mutationId,
      false,
    );
  if (current.binding.type === 'recipe') {
    const recipe = (await listRecipes()).find(
      (r) => r.canonicalUrl === current.binding.recipeUrl,
    );
    if (!recipe)
      throw new WidgetError(
        'The saved recipe is unavailable. Your last copy has been kept.',
        404,
      );
    const snapshot = {
      ...emptySnapshot(recipe.sourceName, { recipe }),
      sources: [{ title: recipe.sourceName, url: recipe.canonicalUrl }],
    };
    const state = recipe.steps.some((s) => stepId(s) === current.state.stepId)
      ? current.state
      : { ...current.state, stepId: stepId(recipe.steps[0] ?? '') };
    return write(owner, current, { snapshot, state }, mutationId, false);
  }
  if (current.binding.type === 'shopping')
    return syncShopping(owner, current, true);
  if (current.binding.type === 'weather')
    return syncWeather(owner, current, true);
  if (current.binding.type === 'generated' && current.query) {
    const generated = await generateWidget(current.query, {
      definition: current.definition,
      snapshot: current.snapshot,
    });
    return write(
      owner,
      current,
      { snapshot: generated.snapshot },
      mutationId,
      false,
    );
  }
  return current;
}

async function syncShopping(owner: string, widget: Widget, always: boolean) {
  try {
    const ctx = await shoppingConnection(owner);
    if (!ctx) return widget;
    if (
      !always &&
      ctx.syncedAt &&
      Date.now() - new Date(ctx.syncedAt).getTime() < 15 * 60_000
    )
      return widget;
    const merged = await syncShoppingItems(
      owner,
      widget.snapshot.data.items ?? [],
      widget.state.checked ?? [],
    );
    if (!merged) return widget;
    const nextChecked = merged.checkedIds.filter((id) =>
      merged.items.some((item) => item.id === id),
    );
    const fetchedAt = new Date().toISOString();
    const snapshot: Snapshot = {
      data: { items: merged.items },
      source: `iCloud Reminders · ${ctx.listName}`,
      sources: [],
      fetchedAt,
      staleAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      expiresAt: null,
    };
    if (
      JSON.stringify(widget.snapshot.data.items) ===
        JSON.stringify(merged.items) &&
      JSON.stringify(widget.state.checked ?? []) ===
        JSON.stringify(nextChecked)
    )
      return widget;
    return await write(
      owner,
      widget,
      { snapshot, state: { ...widget.state, checked: nextChecked } },
      crypto.randomUUID(),
      false,
    );
  } catch (error) {
    if (error instanceof WidgetError && error.status === 409)
      return getWidget(owner, widget.id);
    return widget;
  }
}
async function syncWeather(
  owner: string,
  widget: Widget,
  always: boolean,
  request?: Request,
) {
  if (!always && widget.snapshot.data.weather && !isStale(widget.snapshot))
    return widget;
  try {
    const snapshot = await weatherSnapshot(
      weatherPlace(request, widget.snapshot.data.weather),
      widget.snapshot,
    );
    return await write(
      owner,
      widget,
      { snapshot },
      crypto.randomUUID(),
      false,
    );
  } catch (error) {
    if (error instanceof WidgetError && error.status === 409)
      return getWidget(owner, widget.id);
    return widget;
  }
}
export async function syncShoppingBoard(owner: string) {
  const widgets = await allWidgets(owner);
  for (const widget of widgets.filter((w) => w.binding.type === 'shopping'))
    await syncShopping(owner, widget, true);
}

type IngestItem = { label: string; value: string };
type IngestContent = Record<
  string,
  { label?: string; value?: string; text?: string; items?: IngestItem[] }
>;
const NODE_TYPES = new Set([
  'text',
  'heading',
  'metric',
  'list',
  'checklist',
  'chart',
  'comparison',
  'steps',
  'columns',
  'callout',
]);
function flattenNodes(nodes: LayoutNode[]): LayoutNode[] {
  return nodes.flatMap((n) => [n, ...flattenNodes(n.children)]);
}
/**
 * Server-to-server push for `binding: {type:'ingest', source}` widgets.
 * Auto-provisions a composition card on first push, then merges content into
 * the snapshot on subsequent pushes. The producer keys content by node id.
 */
export async function applyIngest(
  owner: string,
  input: {
    source: string;
    title?: string;
    nodes?: { id: string; type: string }[];
    content: IngestContent;
    staleHours?: number;
  },
): Promise<Widget[]> {
  if (!/^[a-z0-9][\w-]{0,60}$/i.test(input.source))
    throw new WidgetError('That source name is invalid.');
  const content = input.content;
  if (
    !content ||
    typeof content !== 'object' ||
    Array.isArray(content) ||
    !Object.keys(content).length ||
    Object.keys(content).length > 20
  )
    throw new WidgetError('That ingest content is invalid.');
  const clean: IngestContent = {};
  for (const [id, value] of Object.entries(content)) {
    if (!/^[\w-]{1,60}$/.test(id) || !value || typeof value !== 'object')
      throw new WidgetError('That ingest content is invalid.');
    const item = value as NonNullable<IngestContent[string]>;
    const text = (v: unknown, max: number) =>
      typeof v === 'string' && v.length <= max ? v : undefined;
    const items = Array.isArray(item.items)
      ? item.items
          .filter(
            (i): i is IngestItem =>
              !!i &&
              typeof i === 'object' &&
              typeof i.label === 'string' &&
              typeof i.value === 'string' &&
              i.label.length <= 150 &&
              i.value.length <= 150,
          )
          .slice(0, 50)
      : undefined;
    clean[id] = {
      label: text(item.label, 150),
      value: text(item.value, 150),
      text: text(item.text, 1000),
      items,
    };
  }
  const staleHours =
    typeof input.staleHours === 'number' &&
    Number.isFinite(input.staleHours) &&
    input.staleHours > 0
      ? Math.min(input.staleHours, 24 * 30)
      : 48;
  const title =
    typeof input.title === 'string' && input.title.trim().length <= 100
      ? input.title.trim()
      : input.source;
  let widgets = (await allWidgets(owner)).filter(
    (w) => w.binding.type === 'ingest' && w.binding.source === input.source,
  );
  if (!widgets.length) {
    const declared = (input.nodes ?? [])
      .filter(
        (n) =>
          n &&
          /^[\w-]{1,60}$/.test(n.id) &&
          NODE_TYPES.has(n.type) &&
          clean[n.id],
      )
      .slice(0, 4);
    const nodeIds = declared.length
      ? declared.map((n) => n.id)
      : Object.keys(clean).slice(0, 4);
    const types = new Map(declared.map((n) => [n.id, n.type]));
    const definition: Definition = {
      ...baseDefinition('composition', INGEST_TONES[input.source] ?? 'violet'),
      nodes: nodeIds.map((id) => ({
        id,
        type: (types.get(id) ?? 'metric') as LayoutNode['type'],
        children: [],
      })),
      summary: `Updates from ${title}.`,
    };
    widgets = [
      await createWidget(owner, {
        title,
        definition,
        snapshot: emptySnapshot(title),
        binding: { type: 'ingest', source: input.source },
        size: nodeIds.length === 1 ? 'standard' : 'tall',
      }),
    ];
  }
  const now = new Date(),
    next: Widget[] = [];
  for (const widget of widgets) {
    const nodeIds = new Set(
      flattenNodes(widget.definition.nodes).map((n) => n.id),
    );
    const merged = { ...widget.snapshot.data.content };
    for (const [id, value] of Object.entries(clean)) {
      if (!nodeIds.has(id)) continue;
      const previous = merged[id] ?? { text: '', label: '', value: '', items: [] };
      merged[id] = {
        text: value.text ?? previous.text,
        label: value.label ?? previous.label,
        value: value.value ?? previous.value,
        items: value.items ?? previous.items,
      };
    }
    const snapshot: Snapshot = {
      ...widget.snapshot,
      data: { ...widget.snapshot.data, content: merged },
      source: title,
      fetchedAt: now.toISOString(),
      staleAt: new Date(now.getTime() + staleHours * 3_600_000).toISOString(),
    };
    if (JSON.stringify(snapshot) === JSON.stringify(widget.snapshot)) {
      next.push(widget);
      continue;
    }
    next.push(
      await write(
        owner,
        widget,
        input.title ? { snapshot, title } : { snapshot },
        crypto.randomUUID(),
        false,
      ),
    );
  }
  return next;
}
export async function actOnWidget(
  owner: string,
  id: string,
  input: Record<string, unknown>,
) {
  const current = await getWidget(owner, id),
    mutationId = typeof input.mutationId === 'string' ? input.mutationId : '';
  if (!/^[\w-]{8,100}$/.test(mutationId))
    throw new WidgetError('This change needs a request identifier.');
  const seen = await db()
    .prepare(
      'SELECT id FROM widget_mutations WHERE id=? AND owner_id=? AND instance_id=?',
    )
    .bind(mutationId, owner, id)
    .first();
  if (seen) return current;
  if (input.revision !== current.revision)
    throw new WidgetError(
      'This widget changed on another screen. It has been reloaded; please try again.',
      409,
    );
  switch (input.action) {
    case 'keep':
      return write(
        owner,
        current,
        { pinned: true, archived: false },
        mutationId,
      );
    case 'unpin':
      return write(owner, current, { pinned: false }, mutationId);
    case 'remove':
      return write(owner, current, { archived: true }, mutationId);
    case 'restore':
      return write(owner, current, { archived: false }, mutationId);
    case 'offline':
      return write(
        owner,
        current,
        { offlineAllowed: input.allowed === true },
        mutationId,
      );
    case 'state': {
      let state: WidgetState;
      try {
        state = validateState(input.state);
      } catch {
        throw new WidgetError('That widget state is invalid.');
      }
      return write(
        owner,
        current,
        { state: { ...current.state, ...state } },
        mutationId,
        false,
      );
    }
    case 'toggle_checked': {
      const item = typeof input.item === 'string' ? input.item : '';
      if (!item || item.length > 150)
        throw new WidgetError('Choose a checklist item.');
      const checked = current.state.checked ?? [];
      const written = await write(
        owner,
        current,
        {
          state: {
            ...current.state,
            checked: checked.includes(item)
              ? checked.filter((id) => id !== item)
              : [...checked, item].slice(0, 200),
          },
        },
        mutationId,
        false,
      );
      return current.definition.kind === 'shopping'
        ? syncShopping(owner, written, true)
        : written;
    }
    case 'save_recipe': {
      const recipe = current.snapshot.data.recipe;
      if (!recipe) throw new WidgetError('Choose a recipe first.');
      await saveRecipe(recipe);
      return write(owner, current, { pinned: true }, mutationId);
    }
    case 'step': {
      const steps = current.snapshot.data.recipe?.steps;
      if (!steps?.length) throw new WidgetError('Choose a recipe first.');
      const index = Math.max(
        0,
        steps.findIndex((s) => stepId(s) === current.state.stepId),
      );
      const next = Math.max(
        0,
        Math.min(
          steps.length - 1,
          index + (input.direction === 'previous' ? -1 : 1),
        ),
      );
      return write(
        owner,
        current,
        { state: { ...current.state, stepId: stepId(steps[next]) } },
        mutationId,
        false,
      );
    }
    case 'size': {
      const size = input.size as WidgetSize;
      if (!Object.hasOwn(SIZES, size))
        throw new WidgetError('Unknown widget size.');
      if (size === 'small' && !supportsSmall(current))
        throw new WidgetError(
          'This widget needs at least the standard size to stay readable.',
        );
      const others = (await allWidgets(owner)).filter((w) => w.id !== id),
        next: Widget = { ...current, size, layouts: {} };
      for (const cols of [4, 8, 12] as Columns[])
        next.layouts[cols] = packWidgets([...others, next], cols).get(id)!;
      return write(owner, current, { size, layouts: next.layouts }, mutationId);
    }
    case 'move': {
      const columns = input.columns as Columns,
        x = Number(input.x),
        y = Number(input.y);
      if (
        ![4, 8, 12].includes(columns) ||
        ![x, y].every(Number.isInteger) ||
        x < 0 ||
        y < 0 ||
        y > 180
      )
        throw new WidgetError('That position is outside the board.');
      const p = current.layouts[columns] ?? {
        ...SIZES[current.size],
        x: 0,
        y: 0,
      };
      const candidate = { ...p, w: Math.min(p.w, columns), x, y };
      if (x + candidate.w > columns)
        throw new WidgetError('That widget does not fit there.');
      const others = (await allWidgets(owner)).filter((w) => w.id !== id);
      const occupied = packWidgets(others, columns);
      if (
        [...occupied.values()].some(
          (o) =>
            x < o.x + o.w &&
            x + candidate.w > o.x &&
            y < o.y + o.h &&
            y + candidate.h > o.y,
        )
      )
        throw new WidgetError('Another widget is in that space.');
      return write(
        owner,
        current,
        { layouts: { ...current.layouts, [columns]: candidate } },
        mutationId,
      );
    }
    case 'refresh':
      return refreshWidget(owner, current, mutationId);
    case 'refine': {
      const instruction = (
        typeof input.instruction === 'string' ? input.instruction : ''
      )
        .trim()
        .slice(0, 800);
      if (!instruction)
        throw new WidgetError('Describe how to change this widget.');
      if (current.definition.kind === 'recipe') {
        // Recipe refinements change the presentation, never the factual recipe.
        const tone = /light|cream/i.test(instruction) ? 'cream' : 'terracotta';
        return write(
          owner,
          current,
          {
            definition: {
              ...current.definition,
              tone,
              summary: /larger|bigger|simple|read/i.test(instruction)
                ? 'large-steps'
                : current.definition.summary,
            },
            size: 'focus',
            layouts: {},
          },
          mutationId,
        );
      }
      if (!current.query)
        throw new WidgetError(
          'Ask for a new widget to customise this example.',
        );
      const generated = await generateWidget(current.query, {
        definition: current.definition,
        snapshot: current.snapshot,
        instruction,
      });
      return write(
        owner,
        current,
        { ...generated, state: current.state },
        mutationId,
      );
    }
    case 'undo': {
      const row = await db()
        .prepare(
          'SELECT previous_json FROM widget_instances WHERE id=? AND owner_id=?',
        )
        .bind(id, owner)
        .first<{ previous_json: string | null }>();
      if (!row?.previous_json)
        throw new WidgetError('There is no earlier layout change to undo.');
      const previous = JSON.parse(row.previous_json) as Changes;
      // Undo a design/layout change without rewinding cooking/checklist progress.
      return write(
        owner,
        current,
        { ...previous, state: current.state },
        mutationId,
        'consume',
      );
    }
    case 'add_items': {
      if (current.definition.kind !== 'shopping')
        throw new WidgetError('Choose the shopping list first.');
      const items = input.items;
      if (
        !Array.isArray(items) ||
        items.length > 100 ||
        items.some((x) => typeof x !== 'string' || x.length > 400)
      )
        throw new WidgetError('The shopping items are invalid.');
      const curated: CuratedItem[] =
        input.source === 'recipe'
          ? await curateForShopping(items)
          : items.map((text) => ({ text }));
      const previous = current.snapshot.data.items ?? [];
      const texts = new Set(previous.map((x) => normaliseQuery(x.text)));
      const added = curated
        .filter((x) => {
          const key = normaliseQuery(x.text);
          if (!key || texts.has(key)) return false;
          texts.add(key);
          return true;
        })
        .map((item) => ({
          id: crypto.randomUUID(),
          text: item.text,
          ...(item.category ? { category: item.category } : {}),
        }));
      if (previous.length + added.length > 200)
        throw new WidgetError(
          'The shopping list is full. Clear checked items first.',
        );
      const written = await write(
        owner,
        current,
        {
          snapshot: emptySnapshot('Your shopping list', {
            items: [...previous, ...added],
          }),
        },
        mutationId,
      );
      return syncShopping(owner, written, true);
    }
    case 'add_chores': {
      if (current.definition.kind !== 'chores')
        throw new WidgetError('Choose the chores list first.');
      const items = input.items;
      if (!Array.isArray(items) || items.length > 50)
        throw new WidgetError('The chores are invalid.');
      const members = await listMembers(owner);
      const memberFor = (value: unknown) => {
        if (typeof value !== 'string' || !value.trim()) return undefined;
        const key = normaliseQuery(value);
        return (
          members.find((m) => m.id === value) ??
          members.find((m) => normaliseQuery(m.name) === key)
        )?.id;
      };
      const previous = current.snapshot.data.chores ?? [];
      const texts = new Set(previous.map((x) => normaliseQuery(x.text)));
      const added: { id: string; text: string; memberId?: string }[] = [];
      for (const raw of items) {
        const named =
          typeof raw === 'object' && raw !== null
            ? (raw as { text?: unknown; member?: unknown })
            : {};
        const text = (
          typeof raw === 'string' ? raw
          : typeof named.text === 'string' ? named.text
          : ''
        )
          .trim()
          .slice(0, 200);
        const key = normaliseQuery(text);
        if (!key || texts.has(key)) continue;
        texts.add(key);
        const memberId = memberFor(named.member);
        added.push({
          id: crypto.randomUUID(),
          text,
          ...(memberId ? { memberId } : {}),
        });
      }
      if (previous.length + added.length > 60)
        throw new WidgetError(
          'The chores list is full. Clear finished chores first.',
        );
      return write(
        owner,
        current,
        {
          snapshot: emptySnapshot('Household chores', {
            chores: [...previous, ...added],
          }),
        },
        mutationId,
      );
    }
    case 'remove_chore': {
      if (current.definition.kind !== 'chores')
        throw new WidgetError('Choose the chores list first.');
      const item = typeof input.item === 'string' ? input.item : '';
      const chores = current.snapshot.data.chores ?? [];
      if (!chores.some((c) => c.id === item))
        throw new WidgetError('That chore is already gone.');
      return write(
        owner,
        current,
        {
          snapshot: emptySnapshot('Household chores', {
            chores: chores.filter((c) => c.id !== item),
          }),
          state: {
            ...current.state,
            checked: (current.state.checked ?? []).filter(
              (id) => id !== item,
            ),
          },
        },
        mutationId,
      );
    }
    case 'assign_chore': {
      if (current.definition.kind !== 'chores')
        throw new WidgetError('Choose the chores list first.');
      const item = typeof input.item === 'string' ? input.item : '';
      const chores = current.snapshot.data.chores ?? [];
      if (!chores.some((c) => c.id === item))
        throw new WidgetError('That chore is already gone.');
      const memberValue =
        typeof input.member === 'string' ? input.member : '';
      const member = (await listMembers(owner)).find(
        (m) =>
          m.id === memberValue ||
          normaliseQuery(m.name) === normaliseQuery(memberValue),
      );
      return write(
        owner,
        current,
        {
          snapshot: emptySnapshot('Household chores', {
            chores: chores.map((c) =>
              c.id !== item ? c
              : member ? { ...c, memberId: member.id }
              : { id: c.id, text: c.text },
            ),
          }),
        },
        mutationId,
      );
    }
    case 'clear_checked': {
      if (current.definition.kind === 'chores') {
        // Chores recur — clearing starts a fresh round instead of
        // deleting the chores themselves.
        return write(
          owner,
          current,
          { state: { ...current.state, checked: [] } },
          mutationId,
        );
      }
      if (current.definition.kind !== 'shopping')
        throw new WidgetError('Choose the shopping list first.');
      const items = current.snapshot.data.items ?? [],
        checkedIds = new Set(current.state.checked ?? []),
        doomed = items.filter((i) => checkedIds.has(i.id));
      const survivors = items.filter((i) => !checkedIds.has(i.id));
      // Deleting in iCloud is the remote half of clearing; a failed delete
      // keeps the item checked locally so it can be retried.
      if (await shoppingConnection(owner).catch(() => null))
        for (const item of doomed) {
          if (!item.href) continue;
          try {
            await deleteShoppingItem(owner, item.href, item.etag);
          } catch {
            survivors.push(item);
          }
        }
      const written = await write(
        owner,
        current,
        {
          snapshot: emptySnapshot('Your shopping list', {
            items: survivors,
          }),
          state: {
            ...current.state,
            checked: survivors
              .filter((i) => checkedIds.has(i.id))
              .map((i) => i.id),
          },
        },
        mutationId,
      );
      return syncShopping(owner, written, true);
    }
    default:
      throw new WidgetError('That widget action is not supported.');
  }
}
