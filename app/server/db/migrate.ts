import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');

/** Arbitrary constant key for the migration advisory lock. */
const MIGRATION_LOCK = 72_011_001;

export async function migrate(connectionString = config.databaseUrl) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // The server and the worker both migrate at start (e.g. two containers): one waits for the other.
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migration')).rows.map((r) => r.name));
    // Migration files ship as .sql next to this file; in dist they are copied by the build script.
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migration (name) VALUES ($1)', [f]);
      await client.query('COMMIT');
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate().then(() => console.log('migrations applied'), (e) => { console.error(e); process.exit(1); });
}
