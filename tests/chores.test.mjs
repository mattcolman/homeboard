import assert from 'node:assert/strict';
import { test } from 'node:test';
import './prepare-widget-api-test.mjs';
const family = await import('../.wrangler/widget-api-tests/familyroute.mjs');
const widgets = await import('../.wrangler/widget-api-tests/route.mjs');

const base = process.env.HOMEBOARD_TEST_URL || 'http://localhost:5178';
const owner = `chores-test-${crypto.randomUUID()}`;
const headers = { 'oai-authenticated-user-id': owner };

async function board() {
  return (
    await widgets.GET(new Request(`${base}/api/widgets`, { headers }))
  ).json();
}

async function act(widget, action, extra = {}) {
  const r = await widgets.POST(
    new Request(`${base}/api/widgets`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: widget.id,
        revision: widget.revision,
        mutationId: crypto.randomUUID(),
        action,
        ...extra,
      }),
    }),
  );
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  return body.widget;
}

test('chores can be added, assigned, checked, reset and removed', async () => {
  await family.POST(
    new Request(`${base}/api/family`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', name: 'Matt', emoji: '⛳' }),
    }),
  );

  let chores = (await board()).widgets.find(
    (w) => w.definition.kind === 'chores',
  );
  assert.ok(chores);

  // A member name resolves to that member's id.
  chores = await act(chores, 'add_chores', {
    items: [{ text: 'Take out the bins', member: 'Matt' }, 'Water the plants'],
  });
  assert.equal(chores.snapshot.data.chores.length, 2);
  const [bins, plants] = chores.snapshot.data.chores;
  assert.equal(bins.text, 'Take out the bins');
  const members = (await board()).members;
  assert.equal(bins.memberId, members[0].id);
  assert.equal(plants.memberId, undefined);

  // Unknown member names leave the chore unassigned.
  chores = await act(chores, 'assign_chore', {
    item: plants.id,
    member: 'Nobody',
  });
  assert.equal(chores.snapshot.data.chores[1].memberId, undefined);
  chores = await act(chores, 'assign_chore', {
    item: plants.id,
    member: 'matt',
  });
  assert.equal(chores.snapshot.data.chores[1].memberId, members[0].id);

  // Checking a chore keeps it on the list; clearing starts a fresh round.
  chores = await act(chores, 'toggle_checked', { item: bins.id });
  assert.deepEqual(chores.state.checked, [bins.id]);
  chores = await act(chores, 'clear_checked');
  assert.equal(chores.snapshot.data.chores.length, 2);
  assert.deepEqual(chores.state.checked, []);

  chores = await act(chores, 'remove_chore', { item: bins.id });
  assert.deepEqual(
    chores.snapshot.data.chores.map((c) => c.text),
    ['Water the plants'],
  );
});
