import assert from 'node:assert/strict';
import { test } from 'node:test';
import './prepare-widget-api-test.mjs';
const widgets = await import('../.wrangler/widget-api-tests/route.mjs');

const base = process.env.HOMEBOARD_TEST_URL || 'http://localhost:5178';
const owner = `sticky-test-${crypto.randomUUID()}`;
const headers = { 'oai-authenticated-user-id': owner };

async function board() {
  return (
    await widgets.GET(new Request(`${base}/api/widgets`, { headers }))
  ).json();
}

async function post(body) {
  const r = await widgets.POST(
    new Request(`${base}/api/widgets`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: r.status, body: await r.json() };
}

async function act(widget, action, extra = {}) {
  const { status, body } = await post({
    id: widget.id,
    revision: widget.revision,
    mutationId: crypto.randomUUID(),
    action,
    ...extra,
  });
  assert.equal(status, 200, JSON.stringify(body));
  return body.widget;
}

void test('sticky notes can be created and edited', async () => {
  const created = await post({
    action: 'sticky',
    text: '  Plumber Tuesday 9am  ',
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  let sticky = created.body.widget;
  assert.equal(sticky.definition.kind, 'sticky');
  assert.equal(sticky.snapshot.data.note, 'Plumber Tuesday 9am');
  assert.equal(sticky.pinned, true);
  assert.equal(sticky.binding.type, 'sticky');

  // The new sticky note is on the board.
  let current = await board();
  assert.ok(current.widgets.some((w) => w.id === sticky.id));

  // A second note creates a distinct widget; they coexist.
  const second = await post({ action: 'sticky', text: 'Library books due' });
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.notEqual(second.body.widget.id, sticky.id);
  current = await board();
  assert.equal(
    current.widgets.filter((w) => w.definition.kind === 'sticky').length,
    2,
  );

  // Editing replaces the note text.
  sticky = await act(sticky, 'edit_note', {
    text: ' Plumber Wednesday 9am ',
  });
  assert.equal(sticky.snapshot.data.note, 'Plumber Wednesday 9am');

  // Invalid notes are rejected.
  const empty = await post({
    id: sticky.id,
    revision: sticky.revision,
    mutationId: crypto.randomUUID(),
    action: 'edit_note',
    text: '   ',
  });
  assert.equal(empty.status, 400, JSON.stringify(empty.body));
  const long = await post({ action: 'sticky', text: 'x'.repeat(300) });
  assert.equal(long.status, 400, JSON.stringify(long.body));

  // edit_note only applies to sticky notes.
  const chores = current.widgets.find((w) => w.definition.kind === 'chores');
  const wrong = await post({
    id: chores.id,
    revision: chores.revision,
    mutationId: crypto.randomUUID(),
    action: 'edit_note',
    text: 'Not a sticky note',
  });
  assert.equal(wrong.status, 400, JSON.stringify(wrong.body));
});
