#!/usr/bin/env node
// Applies pending drizzle migrations to the local miniflare D1 database.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const d1Dir =
  process.env.HOMEBOARD_D1_DIR ??
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const drizzleDir = 'drizzle';

let dbFiles;
try {
  dbFiles = readdirSync(d1Dir).filter(
    (f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite',
  );
} catch {
  dbFiles = [];
}

if (dbFiles.length === 0) {
  console.log(
    'No local D1 database yet — start npm run dev once, then run npm run migrate.',
  );
  process.exit(0);
}

const migrations = readdirSync(drizzleDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const dbFile of dbFiles) {
  const db = new DatabaseSync(join(d1Dir, dbFile));
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS homeboard_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    const applied = new Set(
      db
        .prepare('SELECT name FROM homeboard_migrations')
        .all()
        .map((row) => row.name),
    );
    const insert = db.prepare(
      'INSERT INTO homeboard_migrations(name, applied_at) VALUES (?, ?)',
    );

    let pending = 0;
    for (const name of migrations) {
      if (applied.has(name)) continue;
      const sql = readFileSync(join(drizzleDir, name), 'utf8');
      const statements = sql
        .split(/^--> statement-breakpoint$/m)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      let failed = null;
      db.exec('BEGIN');
      try {
        for (const statement of statements) {
          try {
            db.exec(statement);
          } catch (err) {
            if (/already exists|duplicate column name/i.test(err.message)) {
              continue; // DBs migrated by hand have no tracking rows
            }
            throw err;
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        failed = err;
      }
      if (failed) {
        console.error(`Migration ${name} failed: ${failed.message}`);
        process.exit(1);
      }
      insert.run(name, new Date().toISOString());
      console.log(`Applied ${name}`);
      pending++;
    }
    if (pending === 0) console.log('Local D1 schema is up to date.');
  } finally {
    db.close();
  }
}
