// Runs the OFFICIAL RealWorld API test suite against this server.
//   npm run test:spec
//
// The tests are not ours: they are the Hurl files from
// https://github.com/realworld-apps/realworld (specs/api/hurl). This script
// downloads them, starts the API on a free port against a throwaway database
// (with-db.js provides it), and lets Hurl fire every request and check every
// response. Passing means any RealWorld frontend could use this backend.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

const specDir = process.env.REALWORLD_SPEC_DIR || path.join(os.tmpdir(), 'realworld-spec');
if (!fs.existsSync(path.join(specDir, 'specs', 'api', 'hurl'))) {
  console.log('Downloading the RealWorld spec...');
  const clone = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/realworld-apps/realworld', specDir], { stdio: 'inherit' });
  if (clone.status !== 0) process.exit(1);
}
const hurlDir = path.join(specDir, 'specs', 'api', 'hurl');
const files = fs.readdirSync(hurlDir).filter((f) => f.endsWith('.hurl')).sort().map((f) => path.join(hurlDir, f));

await runMigrations();
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const host = `http://localhost:${server.address().port}`;

// `uid` makes usernames unique per run, the same way the official runner does.
const uid = `${Date.now()}`;
console.log(`Running ${files.length} official test files against ${host}`);
// Must be the asynchronous spawn: the API server runs in THIS process, and a
// synchronous wait would freeze the event loop so no request could be answered.
const quoted = files.map((f) => `"${f}"`).join(' ');
const hurl = spawn(`npx hurl --test --jobs 1 --variable host=${host} --variable uid=${uid} ${quoted}`, {
  stdio: 'inherit',
  shell: true,
});
const status = await new Promise((resolve) => hurl.on('exit', (code) => resolve(code ?? 1)));

server.closeAllConnections(); // Hurl keeps connections alive; do not wait for them to time out
await new Promise((resolve) => server.close(resolve));
await pool.end();
process.exit(status);
