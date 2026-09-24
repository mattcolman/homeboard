import assert from 'node:assert/strict';
import { test } from 'node:test';
import './prepare-widget-api-test.mjs';
const { peopleForEvent, buildEventPeopleMap } =
  await import('../.wrangler/widget-api-tests/people.mjs');

const CAL_A = 'cal-a';
const CAL_B = 'cal-b';

const Matt = {
  id: 'm-matt',
  name: 'Matt',
  color: '#5f92e7',
  emoji: '⛳',
  calendarIds: [CAL_A],
  aliases: [],
};
const Sophie = {
  id: 'm-sophie',
  name: 'Sophie',
  color: '#e05a8a',
  emoji: '🐨',
  calendarIds: [CAL_B],
  aliases: [],
};
const Hugo = {
  id: 'm-hugo',
  name: 'Hugo',
  color: '#f2a541',
  emoji: '🦕',
  calendarIds: [],
  aliases: [],
};
const Izzy = {
  id: 'm-izzy',
  name: 'Izzy',
  color: '#7ac74f',
  emoji: '🎵',
  calendarIds: [],
  aliases: ['Isabelle', 'Iz'],
};
const members = [Matt, Sophie, Hugo, Izzy];

const event = (title, calendarId, externalUid = `uid-${title}`) => ({
  id: `id-${title}`,
  externalUid,
  calendarId,
  calendarName: 'Family',
  calendarColor: '#315f50',
  title,
  startsAt: '2026-10-01T00:00:00.000Z',
  endsAt: '2026-10-01T01:00:00.000Z',
  allDay: false,
});

const ids = (people) => people.map((p) => p.id);

void test('name match beats calendar owner', () => {
  assert.deepEqual(
    ids(peopleForEvent(event('Izzy clarinet', CAL_A), members, [])),
    [Izzy.id],
  );
});

void test('aliases match', () => {
  assert.deepEqual(
    ids(peopleForEvent(event("Isabelle's recital", CAL_B), members, [])),
    [Izzy.id],
  );
});

void test('multiple people in one event', () => {
  assert.deepEqual(
    ids(peopleForEvent(event('Hugo & Izzy swimming', CAL_A), members, [])),
    [Hugo.id, Izzy.id],
  );
});

void test('calendar owner is the fallback', () => {
  assert.deepEqual(ids(peopleForEvent(event('Dentist', CAL_A), members, [])), [
    Matt.id,
  ]);
  assert.deepEqual(
    ids(peopleForEvent(event('Dentist', 'cal-unknown'), members, [])),
    [],
  );
});

void test('partial words do not match', () => {
  assert.deepEqual(
    ids(peopleForEvent(event('Matthew birthday', CAL_B), members, [])),
    [Sophie.id],
  );
});

void test('explicit assignment wins, empty means shared', () => {
  const e = event('Team meeting', CAL_A, 'uid-meeting');
  const assigned = buildEventPeopleMap([
    { externalUid: 'uid-meeting', memberIds: [Hugo.id] },
  ]);
  assert.deepEqual(ids(peopleForEvent(e, members, assigned)), [Hugo.id]);
  const shared = buildEventPeopleMap([
    { externalUid: 'uid-meeting', memberIds: [] },
  ]);
  assert.deepEqual(peopleForEvent(e, members, shared), []);
});

void test('explicit assignment beats name match', () => {
  const e = event('Izzy clarinet', CAL_A, 'uid-clarinet');
  const assigned = buildEventPeopleMap([
    { externalUid: 'uid-clarinet', memberIds: [Sophie.id] },
  ]);
  assert.deepEqual(ids(peopleForEvent(e, members, assigned)), [Sophie.id]);
});
