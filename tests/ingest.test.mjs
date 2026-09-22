import assert from 'node:assert/strict';
import { test } from 'node:test';
import './prepare-widget-api-test.mjs';
process.env.HOMEBOARD_INGEST_KEY = 'test-ingest-key';
const { POST } = await import('../.wrangler/widget-api-tests/ingest.mjs');
const { GET } = await import('../.wrangler/widget-api-tests/route.mjs');

const base = process.env.HOMEBOARD_TEST_URL || 'http://localhost:5178';
const owner = `ingest-test-${crypto.randomUUID()}`;
const key = { 'x-ingest-key': 'test-ingest-key' };

async function push(body, headers = key) {
  const r = await POST(
    new Request(`${base}/api/ingest`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
  return { status: r.status, body: await r.json() };
}
async function board() {
  const r = await GET(
    new Request(`${base}/api/widgets`, {
      headers: { 'oai-authenticated-user-id': owner },
    }),
  );
  return (await r.json()).widgets;
}

const golf = {
  source: 'golf',
  title: 'Golf handicap',
  owner,
  nodes: [
    { id: 'metric', type: 'metric' },
    { id: 'rounds', type: 'list' },
  ],
  content: {
    metric: { label: 'Handicap', value: '17.8' },
    rounds: { items: [{ label: 'Eastlake', value: '92' }] },
  },
};

test('ingest authenticates the shared key and bounds the request', async () => {
  assert.equal((await push(golf, {})).status, 401);
  assert.equal((await push(golf, { 'x-ingest-key': 'nope' })).status, 401);
  assert.equal((await push('not json')).status, 400);
  assert.equal(
    (await push({ source: 'golf', owner, content: {}, staleHours: 1 })).status,
    400,
  );
  assert.equal(
    (await push({ source: 'not a source!', owner, content: golf.content }))
      .status,
    400,
  );
  assert.equal(
    (await push({ source: 'golf', owner, content: golf.content })).status,
    200,
  );
  const tooMany = Object.fromEntries(
    Array.from({ length: 21 }, (_, i) => [`k${i}`, { value: 'x' }]),
  );
  assert.equal(
    (await push({ source: 'golf', owner, content: tooMany })).status,
    400,
  );
});

test('the first push provisions a card and later pushes merge into it', async () => {
  const first = await push({ ...golf, staleHours: 24 });
  assert.equal(first.body.widgets.length, 1);
  let widget = (await board()).find((w) => w.title === 'Golf handicap');
  assert.ok(widget);
  const content = widget.snapshot.data.content;
  assert.equal(content.metric.value, '17.8');
  assert.equal(content.rounds.items[0].label, 'Eastlake');
  const staleMs = Date.parse(widget.snapshot.staleAt) - Date.now();
  assert.ok(staleMs > 23 * 3_600_000 && staleMs < 25 * 3_600_000);

  // A partial update merges: omitted fields keep their previous values.
  await push({
    source: 'golf',
    owner,
    content: { metric: { value: '17.5' } },
  });
  widget = (await board()).find((w) => w.title === 'Golf handicap');
  const merged = widget.snapshot.data.content;
  assert.equal(merged.metric.value, '17.5');
  assert.equal(merged.metric.label, 'Handicap');
  assert.equal(merged.rounds.items[0].label, 'Eastlake');

  // Content for nodes outside the definition is ignored.
  await push({
    source: 'golf',
    owner,
    content: { extra: { value: 'nope' } },
  });
  widget = (await board()).find((w) => w.title === 'Golf handicap');
  assert.equal(widget.snapshot.data.content.extra, undefined);
});
