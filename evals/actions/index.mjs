// Named actions a scenario step can invoke: { action: 'name' }. Each returns
// { detail } for the report and may add to ctx.facts for later expectations
// via ${facts.*} interpolation.
import { spawn } from 'node:child_process';
import { ensureGolfLogin } from './golf-login.mjs';

const SPIKE_DIR = new URL('../../spike/browser/', import.meta.url).pathname;

export const actions = {
  // Loads the eval board once — also provisions the default widget set for a
  // fresh owner, which scenarios can then assert on.
  async 'board-load'(ctx) {
    const board = await ctx.board.list();
    return {
      facts: { widgetCount: board.widgets.length },
      detail: `${board.widgets.length} widgets on the eval board`,
    };
  },

  // Seeds a Golf handicap widget via /api/ingest with a known value — the
  // "data already exists" variant without needing a live connector.
  async 'push-ingest:golf'(ctx) {
    const handicap = ctx.env('GOLF_EXPECTED_HANDICAP', '17.8');
    await ctx.board.ingest({
      source: 'golf',
      title: 'Golf handicap',
      nodes: [
        { id: 'handicap', type: 'metric' },
        { id: 'rounds', type: 'list' },
      ],
      content: {
        handicap: {
          label: 'Handicap index',
          value: handicap,
          text: `Low ${handicap} · Today`,
        },
        rounds: { items: [] },
      },
      staleHours: 48,
    });
    return {
      facts: { handicap },
      detail: `seeded handicap=${handicap} via /api/ingest`,
    };
  },

  // Seeds a recipe widget with a fixture sourdough recipe — ingredient lines
  // exactly as extraction produces them (quantities, cup conversions, "see
  // notes" tails) — and focuses it so add_recipe_to_shopping resolves the open
  // recipe the way the UI button does.
  async 'seed-recipe:sourdough'(ctx) {
    const widget = await ctx.board.openRecipe({
      title: 'Simple sourdough bread',
      sourceName: 'Eval fixture',
      canonicalUrl: 'https://example.com/eval-sourdough-bread',
      servings: '1 loaf',
      ingredients: [
        '50–100 g (1⁄4–1/2 cup) bubbly, active starter — I always use 100 grams, see notes above',
        '375 g (1 1/2 cups plus 1 tbsp) warm water, or more, see notes above',
        '500 g (4 cups plus 2 tbsp) bread flour',
        '9 to 12 g (1.5–2.5 teaspoons) fine sea salt, see notes above',
      ],
      steps: [
        'Mix the starter and warm water in a large bowl.',
        'Add the flour and salt and stir into a shaggy dough.',
        'Cover and leave to rise until doubled, about 8–12 hours.',
        'Shape the loaf and bake in a hot Dutch oven until deep golden.',
      ],
    });
    if (!widget) throw Error('The recipe could not be seeded.');
    ctx.executor.focused = widget.id;
    return { detail: `seeded recipe widget '${widget.title}'` };
  },

  // Ensures the shared golf.com.au session is logged in (headed Chrome;
  // credentials auto-fill, then human handoff).
  async 'golf-login'(ctx) {
    const result = await ensureGolfLogin({
      askHuman: ctx.askHuman,
      log: ctx.log,
    });
    if (!result.authenticated)
      throw Error('golf.com.au login did not complete.');
    return { detail: `authenticated via ${result.method}` };
  },

  // Runs the spike sync against the eval owner: captures the site's own API
  // data and pushes it to /api/ingest. Requires a live session (golf-login).
  async 'golf-sync'(ctx) {
    const output = await new Promise((resolve, reject) => {
      const child = spawn('node', ['golf-sync.mjs'], {
        cwd: SPIKE_DIR,
        env: {
          ...process.env,
          HOMEBOARD_OWNER: ctx.owner,
          INGEST_URL: `${ctx.board.base}/api/ingest`,
          HOMEBOARD_INGEST_KEY: ctx.env('HOMEBOARD_INGEST_KEY', ''),
        },
      });
      let text = '';
      child.stdout.on('data', (chunk) => {
        text += chunk;
        ctx.log(`golf-sync: ${String(chunk).trimEnd()}`);
      });
      child.stderr.on('data', (chunk) => {
        text += chunk;
        ctx.log(`golf-sync: ${String(chunk).trimEnd()}`);
      });
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0
          ? resolve(text)
          : reject(
              Error(
                text.trim().split('\n').pop() ?? `golf-sync exited ${code}`,
              ),
            ),
      );
    });
    const handicap = /handicap=([\d.]+)/.exec(output)?.[1];
    return {
      facts: handicap ? { handicap } : {},
      detail: output.trim().split('\n').pop(),
    };
  },
};
