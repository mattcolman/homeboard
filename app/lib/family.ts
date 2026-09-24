import { env } from 'cloudflare:workers';
import type { EventPeople, FamilyMember } from './widgets/model';
import { WidgetError } from './widgets/store';
import { MEMBER_COLORS } from './family-palette';

const db = () => (env as unknown as { DB: D1Database }).DB;

type MemberRow = {
  id: string;
  name: string;
  color: string;
  emoji: string;
  calendar_ids_json: string;
  aliases_json: string;
};

function toMember(row: MemberRow): FamilyMember {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    emoji: row.emoji,
    calendarIds: JSON.parse(row.calendar_ids_json),
    aliases: JSON.parse(row.aliases_json),
  };
}

function cleanAliases(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const alias = value.trim().slice(0, 40);
    if (!alias || seen.has(alias.toLocaleLowerCase('en-AU'))) continue;
    seen.add(alias.toLocaleLowerCase('en-AU'));
    aliases.push(alias);
    if (aliases.length === 10) break;
  }
  return aliases;
}

export async function listMembers(owner: string): Promise<FamilyMember[]> {
  const result = await db()
    .prepare(
      'SELECT id,name,color,emoji,calendar_ids_json,aliases_json FROM family_members WHERE owner_id=? ORDER BY ordinal,created_at LIMIT 20',
    )
    .bind(owner)
    .all<MemberRow>();
  return result.results.map(toMember);
}

export async function saveMember(
  owner: string,
  input: Record<string, unknown>,
): Promise<FamilyMember[]> {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 40)
    throw new WidgetError('Add a name for this person.');
  const color = MEMBER_COLORS.includes(String(input.color))
    ? String(input.color)
    : MEMBER_COLORS[0];
  const emoji =
    typeof input.emoji === 'string' &&
    [
      ...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(
        input.emoji,
      ),
    ].length <= 3
      ? input.emoji
      : '';
  const aliases = cleanAliases(input.aliases);
  const calendarIds = Array.isArray(input.calendarIds)
    ? [
        ...new Set(
          input.calendarIds.filter(
            (id): id is string => typeof id === 'string' && id.length <= 300,
          ),
        ),
      ].slice(0, 30)
    : [];
  const id =
    typeof input.id === 'string' && /^[\w-]{8,100}$/.test(input.id)
      ? input.id
      : crypto.randomUUID();
  const existing = await db()
    .prepare('SELECT id FROM family_members WHERE owner_id=? AND id=?')
    .bind(owner, id)
    .first();
  const now = new Date().toISOString();
  const statements = [];
  if (!existing) {
    const count = await db()
      .prepare('SELECT COUNT(*) AS count FROM family_members WHERE owner_id=?')
      .bind(owner)
      .first<{ count: number }>();
    if ((count?.count ?? 0) >= 12)
      throw new WidgetError('Twelve people is plenty for one board.');
    statements.push(
      db()
        .prepare(
          'INSERT INTO family_members(id,owner_id,name,color,emoji,calendar_ids_json,aliases_json,ordinal,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          owner,
          name,
          color,
          emoji,
          JSON.stringify(calendarIds),
          JSON.stringify(aliases),
          count?.count ?? 0,
          now,
        ),
    );
  } else {
    statements.push(
      db()
        .prepare(
          'UPDATE family_members SET name=?,color=?,emoji=?,calendar_ids_json=?,aliases_json=? WHERE owner_id=? AND id=?',
        )
        .bind(
          name,
          color,
          emoji,
          JSON.stringify(calendarIds),
          JSON.stringify(aliases),
          owner,
          id,
        ),
    );
  }
  // A calendar belongs to one person: drop assigned ids from everyone else.
  for (const calendarId of calendarIds)
    statements.push(
      db()
        .prepare(
          `UPDATE family_members SET calendar_ids_json=(
             SELECT json_group_array(value) FROM json_each(calendar_ids_json)
             WHERE value != ?
           ) WHERE owner_id=? AND id != ? AND EXISTS (
             SELECT 1 FROM json_each(calendar_ids_json) WHERE value = ?
           )`,
        )
        .bind(calendarId, owner, id, calendarId),
    );
  await db().batch(statements);
  return listMembers(owner);
}

export async function removeMember(
  owner: string,
  id: unknown,
): Promise<FamilyMember[]> {
  if (typeof id !== 'string' || id.length > 100)
    throw new WidgetError('Choose a person first.');
  await db().batch([
    db()
      .prepare('DELETE FROM family_members WHERE owner_id=? AND id=?')
      .bind(owner, id),
    db()
      .prepare(
        `UPDATE event_people SET member_ids_json=(
           SELECT json_group_array(value) FROM json_each(member_ids_json)
           WHERE value != ?
         ) WHERE owner_id=? AND EXISTS (
           SELECT 1 FROM json_each(member_ids_json) WHERE value = ?
         )`,
      )
      .bind(id, owner, id),
  ]);
  return listMembers(owner);
}

export async function listEventPeople(owner: string): Promise<EventPeople[]> {
  const result = await db()
    .prepare(
      'SELECT external_uid,member_ids_json FROM event_people WHERE owner_id=? LIMIT 500',
    )
    .bind(owner)
    .all<{ external_uid: string; member_ids_json: string }>();
  return result.results.map((row) => ({
    externalUid: row.external_uid,
    memberIds: JSON.parse(row.member_ids_json),
  }));
}

export async function assignEventPeople(
  owner: string,
  input: Record<string, unknown>,
): Promise<EventPeople[]> {
  const externalUid =
    typeof input.externalUid === 'string' ? input.externalUid : '';
  if (!externalUid || externalUid.length > 300)
    throw new WidgetError('Choose an event first.');
  if (input.clear === true) {
    await db()
      .prepare('DELETE FROM event_people WHERE owner_id=? AND external_uid=?')
      .bind(owner, externalUid)
      .run();
    return listEventPeople(owner);
  }
  const valid = new Set((await listMembers(owner)).map((m) => m.id));
  const memberIds = Array.isArray(input.memberIds)
    ? [
        ...new Set(
          input.memberIds.filter(
            (id): id is string => typeof id === 'string' && valid.has(id),
          ),
        ),
      ]
    : [];
  await db()
    .prepare(
      `INSERT INTO event_people(owner_id,external_uid,member_ids_json,created_at) VALUES(?,?,?,?)
       ON CONFLICT(owner_id,external_uid) DO UPDATE SET member_ids_json=excluded.member_ids_json`,
    )
    .bind(
      owner,
      externalUid,
      JSON.stringify(memberIds),
      new Date().toISOString(),
    )
    .run();
  return listEventPeople(owner);
}
