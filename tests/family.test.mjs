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

// iCloud calendar ids are long CalDAV URLs, well past D1's LIKE pattern limit.
const CAL_A =
  'https://p01-caldav.icloud.com/1234567890/calendars/ABCDEF01-2345-6789-ABCD-EF0123456789/';
const CAL_B =
  'https://p01-caldav.icloud.com/1234567890/calendars/FEDCBA98-7654-3210-DCBA-987654321000/';

test('family members can be added, edited and removed', async () => {
  assert.equal((await call({ action: 'save', name: '' })).status, 400);

  const { body } = await call({
    action: 'save',
    name: 'Matt',
    aliases: 'Isabelle, iz, Isabelle',
    color: '#5f92e7',
    emoji: '⛳',
    calendarIds: [CAL_A, CAL_B],
  });
  assert.equal(body.members.length, 1);
  const matt = body.members[0];
  assert.equal(matt.name, 'Matt');
  assert.deepEqual(matt.aliases, ['Isabelle', 'iz']);
  assert.deepEqual(matt.calendarIds, [CAL_A, CAL_B]);
  assert.deepEqual(body.eventPeople, []);

  // The board payload carries members for the calendar view.
  const board = await (
    await widgetsRoute.GET(new Request(`${base}/api/widgets`, { headers }))
  ).json();
  assert.equal(board.members[0].name, 'Matt');
  assert.ok(Array.isArray(board.eventPeople));

  // A calendar can only belong to one person: assigning the second calendar to Sophie
  // removes it from Matt.
  const { body: updated } = await call({
    action: 'save',
    name: 'Sophie',
    color: '#e05a8a',
    emoji: '🐨',
    calendarIds: [CAL_B],
  });
  assert.equal(updated.members.length, 2);
  assert.deepEqual(updated.members.find((m) => m.name === 'Matt').calendarIds, [
    CAL_A,
  ]);

  // Editing the same member keeps it one row.
  const { body: renamed } = await call({
    action: 'save',
    id: matt.id,
    name: 'Matthew',
    color: matt.color,
    emoji: matt.emoji,
    calendarIds: [CAL_A],
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

void test('event people assignments upsert, clear and prune', async () => {
  const { body } = await call({
    action: 'save',
    name: 'Hugo',
    color: '#f2a541',
    emoji: '🦕',
    calendarIds: [],
  });
  const hugo = body.members.at(-1);
  assert.deepEqual(
    (await call({ action: 'assign', externalUid: '' })).status,
    400,
  );

  // Unknown member ids are dropped on assign.
  const { body: assigned } = await call({
    action: 'assign',
    externalUid: 'uid-team-meeting',
    memberIds: [hugo.id, 'not-a-member'],
  });
  assert.deepEqual(assigned.eventPeople, [
    { externalUid: 'uid-team-meeting', memberIds: [hugo.id] },
  ]);

  // Upserting the same event replaces the list rather than duplicating it.
  const { body: replaced } = await call({
    action: 'assign',
    externalUid: 'uid-team-meeting',
    memberIds: [],
  });
  assert.deepEqual(replaced.eventPeople, [
    { externalUid: 'uid-team-meeting', memberIds: [] },
  ]);

  // Removing a member strips their id from every assignment.
  const { body: removed } = await call({ action: 'remove', id: hugo.id });
  assert.deepEqual(removed.eventPeople, [
    { externalUid: 'uid-team-meeting', memberIds: [] },
  ]);

  const { body: again } = await call({
    action: 'assign',
    externalUid: 'uid-team-meeting',
    memberIds: [removed.members[0]?.id ?? 'missing'],
  });
  assert.equal(again.eventPeople.length, 1);

  // clear:true deletes the row so inference resumes.
  const { body: cleared } = await call({
    action: 'assign',
    externalUid: 'uid-team-meeting',
    clear: true,
  });
  assert.deepEqual(cleared.eventPeople, []);
  const { body: get } = await call();
  assert.deepEqual(get.eventPeople, []);
});
