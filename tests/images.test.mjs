import { test } from 'node:test';
import assert from 'node:assert/strict';
import './prepare-widget-api-test.mjs';
const {
  storeImage,
  getImage,
  deleteImages,
  touchImages,
  purgeExpiredImages,
  imageIdsIn,
} = await import('../.wrangler/widget-api-tests/images.mjs');
const { GET } = await import('../.wrangler/widget-api-tests/imageroute.mjs');
const { env } = await import('../.wrangler/widget-api-tests/runtime.mjs');
const base = process.env.HOMEBOARD_TEST_URL || 'http://localhost:5178';
const owner = `image-test-${crypto.randomUUID()}`;
const bytes = new Uint8Array([1, 2, 3, 4]);

await test('store, fetch, touch, purge and delete with owner isolation', async () => {
  const future = new Date(Date.now() + 3600e3).toISOString();
  const id = await storeImage(owner, { bytes, mime: 'image/webp' }, future);
  const found = await getImage(owner, id);
  assert.equal(found.mime, 'image/webp');
  assert.deepEqual(Array.from(found.bytes), [1, 2, 3, 4]);
  assert.equal(await getImage('someone-else', id), null);
  // An expired image reads as missing until touchImages lifts its expiry.
  const past = new Date(Date.now() - 60e3).toISOString();
  const revived = await storeImage(owner, { bytes, mime: 'image/webp' }, past);
  assert.equal(await getImage(owner, revived), null);
  await touchImages(owner, [revived], future);
  assert.ok(await getImage(owner, revived));
  // Purge removes only expired rows.
  const dropped = await storeImage(owner, { bytes, mime: 'image/webp' }, past);
  await purgeExpiredImages(owner);
  assert.equal(
    await env.DB.prepare(
      'SELECT id FROM artifact_images WHERE owner_id=? AND id=?',
    )
      .bind(owner, dropped)
      .first(),
    null,
  );
  assert.ok(await getImage(owner, revived));
  // deleteImages removes listed ids outright.
  await deleteImages(owner, [id, revived]);
  assert.equal(await getImage(owner, id), null);
  assert.deepEqual(
    (
      await env.DB.prepare('SELECT id FROM artifact_images WHERE owner_id=?')
        .bind(owner)
        .all()
    ).results,
    [],
  );
});

await test('imageIdsIn finds kept image URLs', () => {
  const a = '01234567-89ab-cdef-0123-456789abcdef';
  const b = 'aaaaaaa1-89ab-cdef-0123-456789abcdef';
  assert.deepEqual(
    imageIdsIn(
      `<img src="/api/artifacts/images/${a}"><img src="/api/artifacts/images/${a}"><img src="/api/artifacts/images/${b}">`,
    ),
    [a, b],
  );
  assert.deepEqual(imageIdsIn('<img src="https://x/y.png">'), []);
});

await test('GET serves bytes to the owner and 404s otherwise', async () => {
  const id = await storeImage(
    owner,
    { bytes, mime: 'image/webp' },
    new Date(Date.now() + 3600e3).toISOString(),
  );
  const params = Promise.resolve({ id });
  const ok = await GET(
    new Request(`${base}/api/artifacts/images/${id}`, {
      headers: { 'oai-authenticated-user-id': owner },
    }),
    { params },
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Content-Type'), 'image/webp');
  assert.deepEqual(
    Array.from(new Uint8Array(await ok.arrayBuffer())),
    [1, 2, 3, 4],
  );
  const other = await GET(
    new Request(`${base}/api/artifacts/images/${id}`, {
      headers: { 'oai-authenticated-user-id': 'someone-else' },
    }),
    { params },
  );
  assert.equal(other.status, 404);
  const unknown = await GET(
    new Request(
      `${base}/api/artifacts/images/00000000-0000-0000-0000-000000000000`,
      { headers: { 'oai-authenticated-user-id': owner } },
    ),
    { params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000000' }) },
  );
  assert.equal(unknown.status, 404);
});
