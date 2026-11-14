// Tiny migration runner: applies each .sql file in /migrations once, in
// filename order, and records it in the schema_migrations table.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from './db.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function runMigrations() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const applied = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    // Migration + bookkeeping row in one transaction: either both happen or neither.
    await transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    console.log(`migrated: ${file}`);
  }
}

// Allows `npm run migrate` to run this file directly.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runMigrations();
  await pool.end();
}
