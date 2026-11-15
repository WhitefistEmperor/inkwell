import pg from 'pg';
import { config } from './config.js';

// A pool keeps a few connections open and reuses them, instead of opening a
// new TCP connection to PostgreSQL for every request.
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: config.dbPoolSize,
  // Hosted databases that sleep when idle can take a few seconds to wake. Wait
  // for them, but not forever.
  connectionTimeoutMillis: 15_000,
});

// An idle connection can be dropped by the database. Without this handler the
// error would crash the process; with it the pool simply opens a new one.
pool.on('error', (err) => console.error('Idle database connection error:', err.message));

// Every query in the app uses $1, $2... placeholders, so user input is never
// concatenated into SQL. That is what prevents SQL injection.
export const query = (text, params) => pool.query(text, params);

// Runs several queries as one all-or-nothing unit. Used when one logical
// action touches several tables (e.g. an article and its tags).
export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
