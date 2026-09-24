import { test } from 'node:test';
import assert from 'node:assert/strict';
import './prepare-widget-api-test.mjs';
const {
  createArtifact,
  listArtifacts,
  getArtifact,
  setArtifactState,
  keepArtifactAsWidget,
  refineArtifact,
} = await import('../.wrangler/widget-api-tests/artifacts.mjs');
const { createWidget } = await import(
  '../.wrangler/widget-api-tests/store.mjs'
);
const { GET, POST } =
  await import('../.wrangler/widget-api-tests/artifactsroute.mjs');
const { env } = await import('../.wrangler/widget-api-tests/runtime.mjs');
const base = process.env.HOMEBOARD_TEST_URL || 'http://localhost:5178';
const owner = `artifact-test-${crypto.randomUUID()}`;
const headers = {
  'Content-Type': 'application/json',
  'oai-authenticated-user-id': owner,
};
const generated = (title = 'Kilograms and grams') => ({
  title,
  definition: {
    schema: 1,
    theme: 1,
    kind: 'composition',
    tone: 'sky',
    nodes: [{ id: 'a', type: 'metric', children: [] }],
    summary: 's',
  },
  snapshot: {
    data: {
      content: {
        a: { text: '', label: 'Answer', value: '42', items: [] },
      },
    },
    source: 'AI explanation',
    sources: [],
    fetchedAt: new Date().toISOString(),
    staleAt: null,
    expiresAt: null,
  },
});

await test('create, list and get — artifacts never expire', async () => {
  const a = await createArtifact(owner, 'How many grams in a kilogram?', () =>
    Promise.resolve(generated()),
  );
  assert.equal(a.title, 'Kilograms and grams');
  const listed = await listArtifacts(owner);
  assert.deepEqual(
    listed.map((x) => x.id),
    [a.id],
  );
  const round = await getArtifact(owner, a.id);
  assert.equal(round.snapshot.data.content.a.value, '42');
  // A row carrying the legacy TTL stays listed and readable — no expiry.
  const stale = crypto.randomUUID(),
    past = new Date(Date.now() - 60e3).toISOString();
  await env.DB.prepare(
    'INSERT INTO artifacts(id,owner_id,title,query_text,definition_json,snapshot_json,state_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      stale,
      owner,
      'Old visual',
      'old',
      JSON.stringify(generated('Old').definition),
      JSON.stringify(generated('Old').snapshot),
      '{}',
      past,
      past,
    )
    .run();
  assert.deepEqual(
    (await listArtifacts(owner)).map((x) => x.id),
    [a.id, stale],
  );
  assert.equal((await getArtifact(owner, stale)).title, 'Old visual');
  await assert.rejects(
    () => createArtifact(owner, '   ', () => Promise.resolve(generated())),
    /short, specific/,
  );
});

await test('state updates validate and persist', async () => {
  const a = await createArtifact(owner, 'Weekend checklist', () =>
    Promise.resolve(generated('Weekend checklist')),
  );
  const updated = await setArtifactState(owner, a.id, { checked: ['a'] });
  assert.deepEqual(updated.state.checked, ['a']);
  assert.deepEqual((await getArtifact(owner, a.id)).state.checked, ['a']);
  await assert.rejects(
    () => setArtifactState(owner, a.id, { unknown: true }),
    /state is invalid/,
  );
});

await test('keep resolves a board widget and the artifact stays', async () => {
  const a = await createArtifact(owner, 'Compare backyard trees', () =>
    Promise.resolve(generated('Backyard trees')),
  );
  const resolved = {
    widget: { id: 'w-1', title: 'Backyard trees', pinned: true },
    reused: false,
  };
  let calls = 0;
  const { widget, artifact } = await keepArtifactAsWidget(
    owner,
    a.id,
    () => {
      ++calls;
      return Promise.resolve(resolved);
    },
  );
  assert.equal(calls, 1);
  assert.equal(widget.id, 'w-1');
  assert.equal(artifact.id, a.id);
  // The visual is not promoted away — it stays in the gallery.
  assert.ok((await listArtifacts(owner)).some((x) => x.id === a.id));
});

await test('refine updates the visual and keeps state', async () => {
  const a0 = await createArtifact(owner, 'Compare backyard trees', () =>
    Promise.resolve(generated('Backyard trees')),
  );
  await setArtifactState(owner, a0.id, { checked: ['a'] });
  const next = await refineArtifact(owner, a0.id, 'Make it a chart', () =>
    Promise.resolve(generated('Tree chart')),
  );
  assert.equal(next.title, 'Tree chart');
  assert.deepEqual(next.state.checked, ['a']);
  await assert.rejects(
    () =>
      refineArtifact(owner, a0.id, '  ', () => Promise.resolve(generated())),
    /Describe how/,
  );
});

await test('page artifacts round-trip and refine', async () => {
  const page = () => ({
    title: 'How a plant grows',
    definition: {
      schema: 1,
      theme: 1,
      kind: 'page',
      tone: 'emerald',
      nodes: [{ id: 'summary', type: 'text', children: [] }],
      summary: 'Stages of growth.',
      module: {
        html: '<figure><img src="https://upload.wikimedia.org/x.jpg" alt="seed"><figcaption>Seed</figcaption></figure>',
        css: 'figure{margin:0}',
        js: '',
      },
    },
    snapshot: {
      data: {
        content: {
          summary: {
            text: 'Stages of growth.',
            label: '',
            value: '',
            items: [],
          },
        },
      },
      source: 'AI explanation',
      sources: [],
      fetchedAt: new Date().toISOString(),
      staleAt: null,
      expiresAt: null,
    },
  });
  const a = await createArtifact(owner, 'Explain how a plant grows', () =>
    Promise.resolve(page()),
  );
  const round = await getArtifact(owner, a.id);
  assert.equal(round.definition.kind, 'page');
  assert.match(round.definition.module.html, /upload\.wikimedia\.org/);
  let refined = 0;
  const next = await refineArtifact(owner, a.id, 'More pictures', () => {
    ++refined;
    const result = page();
    result.title = 'Refined plant page';
    return Promise.resolve(result);
  });
  assert.equal(refined, 1);
  assert.equal(next.title, 'Refined plant page');
  assert.equal(next.definition.kind, 'page');
});

await test('route: list, get, keep, dismiss and origin checks', async () => {
  const call = async (input, expected = 200, extra = {}) => {
    const request = new Request(
      `${base}/api/artifacts`,
      input
        ? {
            method: 'POST',
            headers: { ...headers, ...extra },
            body: JSON.stringify(input),
          }
        : { headers: { ...headers, ...extra } },
    );
    const r = await (input ? POST : GET)(request);
    const body = await r.json().catch(() => ({}));
    assert.equal(r.status, expected, JSON.stringify(body));
    return body;
  };
  const a = await createArtifact(owner, 'Plan a birthday party', () =>
    Promise.resolve(generated('Birthday plan')),
  );
  const listed = await call();
  const summary = listed.artifacts.find((x) => x.id === a.id);
  assert.equal(summary.title, 'Birthday plan');
  assert.equal(summary.query, 'Plan a birthday party');
  const single = await GET(
    new Request(`${base}/api/artifacts?id=${a.id}`, { headers }),
  );
  assert.equal(single.status, 200);
  assert.equal((await single.json()).artifact.id, a.id);
  // "Keep" reuses the same-query widget instead of generating a new one.
  const keptWidget = await createWidget(owner, {
    title: 'Birthday plan',
    definition: generated('Birthday plan').definition,
    snapshot: generated().snapshot,
    query: 'Plan a birthday party',
    pinned: true,
  });
  const kept = await call({ action: 'keep', id: a.id });
  assert.equal(kept.widget.id, keptWidget.id);
  assert.equal(kept.artifact.id, a.id);
  assert.ok((await call()).artifacts.some((x) => x.id === a.id));
  const b = await createArtifact(owner, 'Dinner ideas', () =>
    Promise.resolve(generated('Dinner ideas')),
  );
  const dismissed = await call({ action: 'dismiss', id: b.id });
  assert.equal(dismissed.dismissed, true);
  assert.ok(!(await call()).artifacts.some((x) => x.id === b.id));
  await call({ action: 'dismiss', id: a.id }, 403, {
    Origin: 'https://unrelated.example',
  });
  await call({ action: 'teleport', id: a.id }, 400);
});
