import { env } from 'cloudflare:workers';
import type { FamilyMember } from './widgets/model';
import { WidgetError } from './widgets/store';
import { MEMBER_COLORS } from './family-palette';

const db = () => (env as unknown as { DB: D1Database }).DB;

type MemberRow = {
  id: string;
  name: string;
  color: string;
  emoji: string;
  calendar_ids_json: string;
};

function toMember(row: MemberRow): FamilyMember {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    emoji: row.emoji,
    calendarIds: JSON.parse(row.calendar_ids_json),
  };
}

export async function listMembers(owner: string): Promise<FamilyMember[]> {
  const result = await db()
    .prepare(
      'SELECT id,name,color,emoji,calendar_ids_json FROM family_members WHERE owner_id=? ORDER BY ordinal,created_at LIMIT 20',
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
      .prepare(
        'SELECT COUNT(*) AS count FROM family_members WHERE owner_id=?',
      )
      .bind(owner)
      .first<{ count: number }>();
    if ((count?.count ?? 0) >= 12)
      throw new WidgetError('Twelve people is plenty for one board.');
    statements.push(
      db()
        .prepare(
          'INSERT INTO family_members(id,owner_id,name,color,emoji,calendar_ids_json,ordinal,created_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          owner,
          name,
          color,
          emoji,
          JSON.stringify(calendarIds),
          count?.count ?? 0,
          now,
        ),
    );
  } else {
    statements.push(
      db()
        .prepare(
          'UPDATE family_members SET name=?,color=?,emoji=?,calendar_ids_json=? WHERE owner_id=? AND id=?',
        )
        .bind(name, color, emoji, JSON.stringify(calendarIds), owner, id),
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
           ) WHERE owner_id=? AND id != ? AND calendar_ids_json LIKE ?`,
        )
        .bind(calendarId, owner, id, `%"${calendarId.replace(/[%_]/g, '')}"%`),
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
  await db()
    .prepare('DELETE FROM family_members WHERE owner_id=? AND id=?')
    .bind(owner, id)
    .run();
  return listMembers(owner);
}
