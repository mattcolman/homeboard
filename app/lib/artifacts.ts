import { env } from 'cloudflare:workers';
import {
  ARTIFACT_NEVER_EXPIRES,
  validateState,
  type Artifact,
  type ArtifactSummary,
} from './widgets/model';
import { generatePage, generateWidget } from './widgets/generation';
import { deleteImages, imageIdsIn } from './images';
import { resolveWidget, WidgetError } from './widgets/store';

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
type Generate = typeof generatePage;
export async function listArtifacts(
  owner: string,
): Promise<ArtifactSummary[]> {
  const r = await db()
    .prepare(
      "SELECT id,title,query_text,created_at,json_extract(definition_json,'$.kind') AS kind FROM artifacts WHERE owner_id=? ORDER BY created_at DESC LIMIT 200",
    )
    .bind(owner)
    .all<{
      id: string;
      title: string;
      query_text: string;
      created_at: string;
      kind: ArtifactSummary['kind'];
    }>();
  return r.results.map((row) => ({
    id: row.id,
    title: row.title,
    query: row.query_text,
    kind: row.kind,
    createdAt: row.created_at,
  }));
}
export async function getArtifact(
  owner: string,
  id: string,
): Promise<Artifact> {
  const r = await db()
    .prepare('SELECT * FROM artifacts WHERE owner_id=? AND id=?')
    .bind(owner, id)
    .first<Row>();
  if (!r) throw new WidgetError('That visual is no longer available.', 404);
  return fromRow(r);
}
export async function createArtifact(
  owner: string,
  query: string,
  generate: Generate = generatePage,
): Promise<Artifact> {
  if (!query.trim() || query.length > 1200)
    throw new WidgetError('Ask a short, specific question.');
  const generated = await generate(query, undefined, { owner });
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
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
      now,
      ARTIFACT_NEVER_EXPIRES,
    )
    .run();
  return getArtifact(owner, id);
}
export async function refineArtifact(
  owner: string,
  id: string,
  instruction: string,
  generate?: Generate,
): Promise<Artifact> {
  const a = await getArtifact(owner, id);
  generate ??= a.definition.kind === 'page' ? generatePage : generateWidget;
  instruction = instruction.trim();
  if (!instruction || instruction.length > 800)
    throw new WidgetError('Describe how to change this visual.');
  const generated = await generate(
    a.query,
    {
      definition: a.definition,
      snapshot: a.snapshot,
      instruction,
    },
    { owner },
  );
  await db()
    .prepare(
      'UPDATE artifacts SET title=?,definition_json=?,snapshot_json=?,expires_at=? WHERE owner_id=? AND id=?',
    )
    .bind(
      generated.title,
      JSON.stringify(generated.definition),
      JSON.stringify(generated.snapshot),
      ARTIFACT_NEVER_EXPIRES,
      owner,
      id,
    )
    .run();
  // Illustrations the refinement dropped can be deleted; kept ones stay.
  const orphaned = new Set(imageIdsIn(a.definition.module?.html ?? ''));
  for (const kept of imageIdsIn(generated.definition.module?.html ?? ''))
    orphaned.delete(kept);
  await deleteImages(owner, [...orphaned]);
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
// "Keep this" turns the visual's question into a proper board widget; the
// artifact itself stays in the gallery.
export async function keepArtifactAsWidget(
  owner: string,
  id: string,
  resolve: typeof resolveWidget = resolveWidget,
): Promise<{ widget: import('./widgets/model').Widget; artifact: Artifact }> {
  const a = await getArtifact(owner, id);
  const { widget } = await resolve(owner, a.query);
  return { widget, artifact: a };
}
export async function dismissArtifact(
  owner: string,
  id: string,
): Promise<void> {
  const a = await getArtifact(owner, id);
  await db()
    .prepare('DELETE FROM artifacts WHERE owner_id=? AND id=?')
    .bind(owner, id)
    .run();
  await deleteImages(owner, imageIdsIn(a.definition.module?.html ?? ''));
}
