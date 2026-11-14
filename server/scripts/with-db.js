// Usage: node scripts/with-db.js <dev|test> <command...>
//
// Runs <command> with DATABASE_URL pointing at a real PostgreSQL server.
// If DATABASE_URL is already set (your own Postgres, Docker, a cloud database)
// it is used as-is. Otherwise this starts a private PostgreSQL using the
// `embedded-postgres` package, so the project runs with nothing but Node installed.
//   dev  -> data kept in server/.pgdata between runs
//   test -> a throwaway database in the temp folder, deleted afterwards
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [mode, ...command] = process.argv.slice(2);
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
if (mode === 'test') env.NODE_ENV = 'test';

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let embedded = null;
let tempDir = null;

// True if a PostgreSQL server already answers at this URL.
async function canConnect(url) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

if (!env.DATABASE_URL) {
  const isTest = mode === 'test';
  const port = isTest ? await freePort() : 54329;
  env.DATABASE_URL = `postgres://postgres:postgres@localhost:${port}/inkwell`;

  // The dev database may still be running: from another terminal (e.g. `npm
  // run seed` while `npm run dev` is up), or because the last run was closed
  // without Ctrl+C. In that case just use it.
  if (!isTest && (await canConnect(env.DATABASE_URL))) {
    console.log(`[with-db] using the PostgreSQL already running on port ${port}`);
  } else {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    if (isTest) tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inkwell-test-'));
    const databaseDir = isTest ? path.join(tempDir, 'data') : path.join(serverDir, '.pgdata');
    const alreadyInitialised = fs.existsSync(path.join(databaseDir, 'PG_VERSION'));
    const log = [];

    embedded = new EmbeddedPostgres({
      databaseDir,
      port,
      user: 'postgres',
      password: 'postgres',
      persistent: !isTest,
      onLog: (line) => log.push(String(line)),
      onError: (line) => log.push(String(line)),
    });
    try {
      if (!alreadyInitialised) await embedded.initialise();
      await embedded.start();
    } catch {
      console.error(log.join('\n'));
      console.error('[with-db] PostgreSQL failed to start. If the log mentions "old server processes", end the leftover postgres processes and try again.');
      process.exit(1);
    }
    try {
      await embedded.createDatabase('inkwell');
    } catch {
      // database already exists from a previous run
    }
    console.log(`[with-db] embedded PostgreSQL ready on port ${port}`);
  }
}

async function cleanup() {
  if (embedded) await embedded.stop().catch(() => {});
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}

const [bin, ...args] = command;
const child = spawn(bin === 'node' ? process.execPath : bin, args, { cwd: serverDir, env, stdio: 'inherit' });

let exiting = false;
async function finish(code) {
  if (exiting) return;
  exiting = true;
  await cleanup();
  process.exitCode = code; // let Node exit on its own once everything is closed
}

child.on('exit', (code) => finish(code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill();
    finish(0);
  });
}
