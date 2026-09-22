import assert from 'node:assert/strict';
import { test } from 'node:test';
import './prepare-widget-api-test.mjs';
const { GET, POST } = await import(
  '../.wrangler/widget-api-tests/familyroute.mjs'
);
const widgetsRoute = await import(
  '../.wrangler/widget-api-tests/route.mjs'
);

const base = process.env.HOMEBOARD_TEST_URL || 'http://localhost:5178';
const owner = `family-test-${crypto.randomUUID()}`;
const headers = { 'oai-authenticated-user-id': owner };

async function call(input) {
  const r = await (input ? POST : GET)(
    new Request(`${base}/api/family`, {
      method: input ? 'POST' : 'GET',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: input ? JSON.stringify(input) : undefined,
    }),
  );
  return { status: r.status, body: await r.json() };
}

test('family members can be added, edited and removed', async () => {
  assert.equal((await call({ action: 'save', name: '' })).status, 400);

  const { body } = await call({
    action: 'save',
    name: 'Matt',
    color: '#5f92e7',
    emoji: '⛳',
    calendarIds: ['cal-a', 'cal-b'],
  });
  assert.equal(body.members.length, 1);
  const matt = body.members[0];
  assert.equal(matt.name, 'Matt');
  assert.deepEqual(matt.calendarIds, ['cal-a', 'cal-b']);

  // The board payload carries members for the calendar view.
  const board = await (
    await widgetsRoute.GET(
      new Request(`${base}/api/widgets`, { headers }),
    )
  ).json();
  assert.equal(board.members[0].name, 'Matt');

  // A calendar can only belong to one person: assigning cal-b to Sophie
  // removes it from Matt.
  const { body: updated } = await call({
    action: 'save',
    name: 'Sophie',
    color: '#e05a8a',
    emoji: '🐨',
    calendarIds: ['cal-b'],
  });
  assert.equal(updated.members.length, 2);
  assert.deepEqual(
    updated.members.find((m) => m.name === 'Matt').calendarIds,
    ['cal-a'],
  );

  // Editing the same member keeps it one row.
  const { body: renamed } = await call({
    action: 'save',
    id: matt.id,
    name: 'Matthew',
    color: matt.color,
    emoji: matt.emoji,
    calendarIds: ['cal-a'],
  });
  assert.equal(renamed.members.length, 2);
  assert.equal(renamed.members[0].name, 'Matthew');

  await call({ action: 'remove', id: matt.id });
  const { body: remaining } = await call();
  assert.equal(remaining.members.length, 1);

  // Members are scoped to the owner.
  const other = await (
    await GET(
      new Request(`${base}/api/family`, {
        headers: { 'oai-authenticated-user-id': 'someone-else' },
      }),
    )
  ).json();
  assert.equal(other.members.length, 0);
});
