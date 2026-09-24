import { test } from 'node:test';
import assert from 'node:assert/strict';
import './prepare-widget-api-test.mjs';
const {
  createArtifact,
  listArtifacts,
  listRecentArtifacts,
  getArtifact,
  setArtifactState,
  saveArtifact,
  refineArtifact,
} = await import('../.wrangler/widget-api-tests/artifacts.mjs');
const { ARTIFACT_NEVER_EXPIRES } = await import(
  '../.wrangler/widget-api-tests/model.mjs'
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

await test('create lands in recent answers; the gallery holds saved only', async () => {
  const a = await createArtifact(owner, 'How many grams in a kilogram?', () =>
    Promise.resolve(generated()),
  );
  assert.equal(a.title, 'Kilograms and grams');
  assert.equal(a.saved, false);
  const ttl = new Date(a.expiresAt).getTime() - Date.now();
  assert.ok(ttl > 23 * 3600e3 && ttl <= 24 * 3600e3);
  // Recent answers show it; the gallery does not.
  assert.deepEqual(
    (await listRecentArtifacts(owner)).map((x) => x.id),
    [a.id],
  );
  assert.deepEqual(await listArtifacts(owner), []);
  const round = await getArtifact(owner, a.id);
  assert.equal(round.snapshot.data.content.a.value, '42');
  // Expired rows are purged from recent and unreadable.
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
    (await listRecentArtifacts(owner)).map((x) => x.id),
    [a.id],
  );
  await assert.rejects(() => getArtifact(owner, stale), /no longer available/);
  await assert.rejects(
    () => createArtifact(owner, '   ', () => Promise.resolve(generated())),
    /short, specific/,
  );
});

await test('save lifts the TTL and files the artifact in the gallery', async () => {
  const a = await createArtifact(owner, 'Why is the sky blue?', () =>
    Promise.resolve(generated('Blue sky')),
  );
  assert.equal(a.saved, false);
  const saved = await saveArtifact(owner, a.id);
  assert.equal(saved.saved, true);
  assert.equal(saved.expiresAt, ARTIFACT_NEVER_EXPIRES);
  assert.deepEqual(
    (await listArtifacts(owner)).map((x) => x.id),
    [a.id],
  );
  // Saved rows still show in recent answers, marked saved.
  const recent = await listRecentArtifacts(owner);
  const row = recent.find((x) => x.id === a.id);
  assert.equal(row.saved, true);
  // Saving twice is a no-op.
  assert.equal((await saveArtifact(owner, a.id)).saved, true);
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

await test('refine updates the visual, keeps state and refreshes the TTL', async () => {
  const a0 = await createArtifact(owner, 'Compare backyard trees', () =>
    Promise.resolve(generated('Backyard trees')),
  );
  await setArtifactState(owner, a0.id, { checked: ['a'] });
  const next = await refineArtifact(owner, a0.id, 'Make it a chart', () =>
    Promise.resolve(generated('Tree chart')),
  );
  assert.equal(next.title, 'Tree chart');
  assert.deepEqual(next.state.checked, ['a']);
  assert.equal(next.saved, false);
  const ttl = new Date(next.expiresAt).getTime() - Date.now();
  assert.ok(ttl > 23 * 3600e3 && ttl <= 24 * 3600e3);
  // Refining a saved artifact keeps it permanent.
  const kept = await saveArtifact(owner, a0.id);
  assert.equal(kept.saved, true);
  const again = await refineArtifact(owner, a0.id, 'Wider chart', () =>
    Promise.resolve(generated('Wide chart')),
  );
  assert.equal(again.expiresAt, ARTIFACT_NEVER_EXPIRES);
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

await test('route: scopes, get, save, keep, dismiss and origin checks', async () => {
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
  // The default list is saved-only; fresh answers live under scope=recent.
  assert.ok(!(await call()).artifacts.some((x) => x.id === a.id));
  const recentResponse = await GET(
    new Request(`${base}/api/artifacts?scope=recent`, { headers }),
  );
  const summary = (await recentResponse.json()).artifacts.find(
    (x) => x.id === a.id,
  );
  assert.equal(summary.title, 'Birthday plan');
  assert.equal(summary.query, 'Plan a birthday party');
  assert.equal(summary.saved, false);
  const single = await GET(
    new Request(`${base}/api/artifacts?id=${a.id}`, { headers }),
  );
  assert.equal(single.status, 200);
  assert.equal((await single.json()).artifact.id, a.id);
  // Artifact-to-board promotion was removed — keep is not a valid action.
  await call({ action: 'keep', id: a.id }, 400);
  // Saving files it in the gallery and lifts the TTL.
  const saved = await call({ action: 'save', id: a.id });
  assert.equal(saved.artifact.saved, true);
  assert.equal(saved.artifact.expiresAt, ARTIFACT_NEVER_EXPIRES);
  const gallery = await call();
  assert.ok(gallery.artifacts.some((x) => x.id === a.id));
  const b = await createArtifact(owner, 'Dinner ideas', () =>
    Promise.resolve(generated('Dinner ideas')),
  );
  const dismissed = await call({ action: 'dismiss', id: b.id });
  assert.equal(dismissed.dismissed, true);
  const gone = await GET(
    new Request(`${base}/api/artifacts?id=${b.id}`, { headers }),
  );
  assert.equal(gone.status, 404);
  await call({ action: 'dismiss', id: a.id }, 403, {
    Origin: 'https://unrelated.example',
  });
  await call({ action: 'teleport', id: a.id }, 400);
});
