import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

const SCRIPT = 'scripts/migrate-local.mjs';

function migrate(dir) {
  return execFileSync(process.execPath, [SCRIPT], {
    env: { ...process.env, HOMEBOARD_D1_DIR: dir },
    encoding: 'utf8',
  });
}

function tableNames(path) {
  const db = new DatabaseSync(path);
  try {
    return new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((r) => r.name),
    );
  } finally {
    db.close();
  }
}

const migrationFiles = readdirSync('drizzle').filter((f) =>
  f.endsWith('.sql'),
).length;

await test('migrate-local applies all drizzle migrations to a fresh DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homeboard-d1-'));
  const dbPath = join(dir, 'x.sqlite');
  new DatabaseSync(dbPath).close();
  new DatabaseSync(join(dir, 'metadata.sqlite')).close();

  migrate(dir);

  const tables = tableNames(dbPath);
  for (const t of ['artifacts', 'artifact_images', 'homeboard_migrations']) {
    if (!tables.has(t)) throw new Error(`missing table ${t}`);
  }

  const db = new DatabaseSync(dbPath);
  const count = Number(
    db.prepare('SELECT COUNT(*) AS n FROM homeboard_migrations').get().n,
  );
  db.close();
  if (count !== migrationFiles) {
    throw new Error(`expected ${migrationFiles} tracking rows, got ${count}`);
  }

  // metadata.sqlite must be left untouched
  if (statSync(join(dir, 'metadata.sqlite')).size !== 0) {
    throw new Error('metadata.sqlite was modified');
  }
});

await test('migrate-local is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homeboard-d1-'));
  const dbPath = join(dir, 'x.sqlite');
  new DatabaseSync(dbPath).close();

  migrate(dir);
  const out = migrate(dir);
  if (!out.includes('up to date')) {
    throw new Error(`expected "up to date", got: ${out}`);
  }
  const db = new DatabaseSync(dbPath);
  const count = Number(
    db.prepare('SELECT COUNT(*) AS n FROM homeboard_migrations').get().n,
  );
  db.close();
  if (count !== migrationFiles) {
    throw new Error('second run changed tracking rows');
  }
});

await test('migrate-local tolerates a hand-migrated DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'homeboard-d1-'));
  const dbPath = join(dir, 'x.sqlite');
  const db = new DatabaseSync(dbPath);
  const first = readdirSync('drizzle')
    .filter((f) => f.endsWith('.sql'))
    .sort()[0];
  // Simulate a DB migrated by hand: schema applied, no tracking rows.
  db.exec(readFileSync(join('drizzle', first), 'utf8'));
  db.close();

  const out = migrate(dir); // must not fail on existing tables

  const db2 = new DatabaseSync(dbPath);
  const count = Number(
    db2.prepare('SELECT COUNT(*) AS n FROM homeboard_migrations').get().n,
  );
  db2.close();
  if (count !== migrationFiles) {
    throw new Error(`expected ${migrationFiles} tracking rows, got ${count}`);
  }
  if (!out.includes(`Applied ${first}`)) {
    throw new Error(`expected re-applied ${first} to be tracked: ${out}`);
  }
});
