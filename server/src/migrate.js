// Tiny migration runner: applies each .sql file in /migrations once, in
// filename order, and records it in the schema_migrations table.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Any fixed number: it names the lock that all Inkwell instances agree on.
const MIGRATION_LOCK = 727274;

export async function runMigrations() {
  // Everything runs on one connection that holds an advisory lock. If two
  // copies of the server start at the same moment (which happens on
  // serverless hosts), the second waits here until the first has finished,
  // then finds nothing left to apply.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);

    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
      // Migration + bookkeeping row in one transaction: either both happen or neither.
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      console.log(`migrated: ${file}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}

// Allows `npm run migrate` to run this file directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMigrations();
  await pool.end();
}
