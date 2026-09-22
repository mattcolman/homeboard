import { env } from 'cloudflare:workers';
import { ARTIFACT_TTL_MS, validateState, type Artifact } from './widgets/model';
import { generateWidget } from './widgets/generation';
import { createWidget, getWidget, WidgetError } from './widgets/store';

const db = () => (env as unknown as { DB: D1Database }).DB;
type Row = {
  id: string;
  title: string;
  query_text: string;
  definition_json: string;
  snapshot_json: string;
  state_json: string;
  promoted_widget_id: string | null;
  created_at: string;
  expires_at: string;
};
function fromRow(r: Row): Artifact {
  return {
    id: r.id,
    title: r.title,
    query: r.query_text,
    definition: JSON.parse(r.definition_json),
    snapshot: JSON.parse(r.snapshot_json),
    state: JSON.parse(r.state_json),
    promotedWidgetId: r.promoted_widget_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  };
}
type Generate = typeof generateWidget;
async function purgeExpired(owner: string) {
  await db()
    .prepare('DELETE FROM artifacts WHERE owner_id=? AND expires_at<=?')
    .bind(owner, new Date().toISOString())
    .run();
}
export async function listArtifacts(owner: string): Promise<Artifact[]> {
  await purgeExpired(owner);
  const r = await db()
    .prepare(
      'SELECT * FROM artifacts WHERE owner_id=? AND promoted_widget_id IS NULL ORDER BY created_at DESC LIMIT 12',
    )
    .bind(owner)
    .all<Row>();
  return r.results.map(fromRow);
}
export async function getArtifact(
  owner: string,
  id: string,
): Promise<Artifact> {
  const r = await db()
    .prepare('SELECT * FROM artifacts WHERE owner_id=? AND id=?')
    .bind(owner, id)
    .first<Row>();
  if (!r || r.expires_at <= new Date().toISOString())
    throw new WidgetError('That visual is no longer available.', 404);
  return fromRow(r);
}
export async function createArtifact(
  owner: string,
  query: string,
  generate: Generate = generateWidget,
): Promise<Artifact> {
  if (!query.trim() || query.length > 1200)
    throw new WidgetError('Ask a short, specific question.');
  const generated = await generate(query);
  const id = crypto.randomUUID(),
    now = new Date(),
    expires = new Date(now.getTime() + ARTIFACT_TTL_MS).toISOString();
  await db()
    .prepare(
      'INSERT INTO artifacts(id,owner_id,title,query_text,definition_json,snapshot_json,state_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      id,
      owner,
      generated.title,
      query,
      JSON.stringify(generated.definition),
      JSON.stringify(generated.snapshot),
      '{}',
      now.toISOString(),
      expires,
    )
    .run();
  return getArtifact(owner, id);
}
export async function refineArtifact(
  owner: string,
  id: string,
  instruction: string,
  generate: Generate = generateWidget,
): Promise<Artifact> {
  const a = await getArtifact(owner, id);
  instruction = instruction.trim();
  if (!instruction || instruction.length > 800)
    throw new WidgetError('Describe how to change this visual.');
  const generated = await generate(a.query, {
    definition: a.definition,
    snapshot: a.snapshot,
    instruction,
  });
  await db()
    .prepare(
      'UPDATE artifacts SET title=?,definition_json=?,snapshot_json=?,expires_at=? WHERE owner_id=? AND id=?',
    )
    .bind(
      generated.title,
      JSON.stringify(generated.definition),
      JSON.stringify(generated.snapshot),
      new Date(Date.now() + ARTIFACT_TTL_MS).toISOString(),
      owner,
      id,
    )
    .run();
  return getArtifact(owner, id);
}
export async function setArtifactState(
  owner: string,
  id: string,
  state: unknown,
): Promise<Artifact> {
  await getArtifact(owner, id);
  let next;
  try {
    next = validateState(state);
  } catch {
    throw new WidgetError('That visual state is invalid.');
  }
  await db()
    .prepare('UPDATE artifacts SET state_json=? WHERE owner_id=? AND id=?')
    .bind(JSON.stringify(next), owner, id)
    .run();
  return getArtifact(owner, id);
}
export async function promoteArtifact(
  owner: string,
  id: string,
): Promise<{ widget: import('./widgets/model').Widget; artifact: Artifact }> {
  const a = await getArtifact(owner, id);
  if (a.promotedWidgetId)
    return { widget: await getWidget(owner, a.promotedWidgetId), artifact: a };
  const widget = await createWidget(owner, {
    title: a.title,
    definition: a.definition,
    snapshot: a.snapshot,
    state: a.state,
    query: a.query,
    pinned: true,
    size: a.definition.kind === 'module' ? 'wide' : 'standard',
  });
  await db()
    .prepare(
      'UPDATE artifacts SET promoted_widget_id=? WHERE owner_id=? AND id=?',
    )
    .bind(widget.id, owner, id)
    .run();
  return { widget, artifact: await getArtifact(owner, id) };
}
export async function dismissArtifact(
  owner: string,
  id: string,
): Promise<void> {
  await db()
    .prepare('DELETE FROM artifacts WHERE owner_id=? AND id=?')
    .bind(owner, id)
    .run();
}
