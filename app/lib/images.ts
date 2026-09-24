import { env } from 'cloudflare:workers';

const db = () => (env as unknown as { DB: D1Database }).DB;

export type ImageShape = 'landscape' | 'square' | 'portrait';
const SIZES: Record<ImageShape, string> = {
  landscape: '1536x1024',
  square: '1024x1024',
  portrait: '1024x1536',
};

export async function generateImage(
  prompt: string,
  shape: ImageShape,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Error('Image generation is unavailable.');
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    signal: AbortSignal.timeout(75000),
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.HOMEBOARD_IMAGE_MODEL || 'gpt-image-2',
      prompt,
      size: SIZES[shape],
      quality: process.env.HOMEBOARD_IMAGE_QUALITY || 'medium',
      output_format: 'webp',
      output_compression: 80,
    }),
  });
  if (!response.ok) throw Error(`Image request failed (${response.status}).`);
  const payload = (await response.json()) as {
    data?: { b64_json?: string }[];
  };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) throw Error('The image came back empty.');
  return {
    bytes: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
    mime: 'image/webp',
  };
}

type Row = {
  id: string;
  mime: string;
  bytes: Uint8Array;
};

export async function storeImage(
  owner: string,
  image: { bytes: Uint8Array; mime: string },
  expiresAt: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await db()
    .prepare(
      'INSERT INTO artifact_images(id,owner_id,mime,bytes,created_at,expires_at) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      id,
      owner,
      image.mime,
      image.bytes,
      new Date().toISOString(),
      expiresAt,
    )
    .run();
  return id;
}

export async function getImage(
  owner: string,
  id: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const row = await db()
    .prepare(
      'SELECT id,mime,bytes,expires_at FROM artifact_images WHERE owner_id=? AND id=?',
    )
    .bind(owner, id)
    .first<Row & { expires_at: string }>();
  if (!row) return null;
  const bytes =
    row.bytes instanceof Uint8Array
      ? row.bytes
      : new Uint8Array(row.bytes as unknown as ArrayBuffer);
  return { bytes, mime: row.mime };
}

export async function deleteImages(
  owner: string,
  ids: string[],
): Promise<void> {
  if (!ids.length) return;
  const marks = ids.map(() => '?').join(',');
  await db()
    .prepare(
      `DELETE FROM artifact_images WHERE owner_id=? AND id IN (${marks})`,
    )
    .bind(owner, ...ids)
    .run();
}

export const IMAGE_PATH = '/api/artifacts/images/';

export function imageIdsIn(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(
    /\/api\/artifacts\/images\/([0-9a-fA-F-]{36})/g,
  ))
    found.add(match[1].toLowerCase());
  return [...found];
}
