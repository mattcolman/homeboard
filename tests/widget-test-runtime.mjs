import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
const sqlite = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle')
  .filter((name) => name.endsWith('.sql'))
  .sort())
  sqlite.exec(readFileSync(`drizzle/${file}`, 'utf8'));
class Prepared {
  constructor(sql, args = []) {
    this.sql = sql;
    this.args = args;
  }
  bind(...args) {
    return new Prepared(this.sql, args);
  }
  async first() {
    return sqlite.prepare(this.sql).get(...this.args) ?? null;
  }
  async all() {
    return { results: sqlite.prepare(this.sql).all(...this.args) };
  }
  async run() {
    const result = sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}
export const env = {
  DB: {
    prepare: (sql) => new Prepared(sql),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  },
};
