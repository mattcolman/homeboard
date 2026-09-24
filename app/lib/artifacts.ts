import { env } from 'cloudflare:workers';
import {
  ARTIFACT_NEVER_EXPIRES,
  ARTIFACT_TTL_MS,
  artifactSaved,
  validateState,
  type Artifact,
  type ArtifactSummary,
} from './widgets/model';
import { generatePage, generateWidget } from './widgets/generation';
import {
  deleteImages,
  imageIdsIn,
  purgeExpiredImages,
  touchImages,
} from './images';
import { WidgetError } from './widgets/store';

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
    saved: artifactSaved(r),
  };
}
type Generate = typeof generatePage;
async function purgeExpired(owner: string) {
  await db()
    .prepare('DELETE FROM artifacts WHERE owner_id=? AND expires_at<=?')
    .bind(owner, new Date().toISOString())
    .run();
  await purgeExpiredImages(owner);
}
/** Saved artifacts for the gallery. */
export async function listArtifacts(
  owner: string,
): Promise<ArtifactSummary[]> {
  await purgeExpired(owner);
  const r = await db()
    .prepare(
      "SELECT id,title,query_text,created_at,expires_at,json_extract(definition_json,'$.kind') AS kind FROM artifacts WHERE owner_id=? AND expires_at=? ORDER BY created_at DESC LIMIT 200",
    )
    .bind(owner, ARTIFACT_NEVER_EXPIRES)
    .all<{
      id: string;
      title: string;
      query_text: string;
      created_at: string;
      expires_at: string;
      kind: ArtifactSummary['kind'];
    }>();
  return r.results.map((row) => ({
    id: row.id,
    title: row.title,
    query: row.query_text,
    kind: row.kind,
    createdAt: row.created_at,
    saved: true,
  }));
}
/** Everything not yet expired — the board's Recent answers strip. */
export async function listRecentArtifacts(
  owner: string,
): Promise<Artifact[]> {
  await purgeExpired(owner);
  const r = await db()
    .prepare(
      'SELECT * FROM artifacts WHERE owner_id=? ORDER BY created_at DESC LIMIT 12',
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
  generate: Generate = generatePage,
): Promise<Artifact> {
  if (!query.trim() || query.length > 1200)
    throw new WidgetError('Ask a short, specific question.');
  const generated = await generate(query, undefined, { owner });
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
  generate: Generate | undefined = generatePage,
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
  // Saved artifacts stay permanent; unsaved ones get a fresh day.
  const expires = artifactSaved(a)
    ? ARTIFACT_NEVER_EXPIRES
    : new Date(Date.now() + ARTIFACT_TTL_MS).toISOString();
  await db()
    .prepare(
      'UPDATE artifacts SET title=?,definition_json=?,snapshot_json=?,expires_at=? WHERE owner_id=? AND id=?',
    )
    .bind(
      generated.title,
      JSON.stringify(generated.definition),
      JSON.stringify(generated.snapshot),
      expires,
      owner,
      id,
    )
    .run();
  const kept = imageIdsIn(generated.definition.module?.html ?? '');
  await touchImages(owner, kept, expires);
  // Illustrations the refinement dropped can be deleted outright.
  const orphaned = new Set(imageIdsIn(a.definition.module?.html ?? ''));
  for (const id of kept) orphaned.delete(id);
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
/** Lifts the TTL and files the artifact in the gallery. */
export async function saveArtifact(
  owner: string,
  id: string,
): Promise<Artifact> {
  const a = await getArtifact(owner, id);
  await db()
    .prepare('UPDATE artifacts SET expires_at=? WHERE owner_id=? AND id=?')
    .bind(ARTIFACT_NEVER_EXPIRES, owner, id)
    .run();
  // Its illustrations become permanent too.
  await touchImages(
    owner,
    imageIdsIn(a.definition.module?.html ?? ''),
    ARTIFACT_NEVER_EXPIRES,
  );
  return getArtifact(owner, id);
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
