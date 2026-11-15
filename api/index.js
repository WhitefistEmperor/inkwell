// Entry point when Inkwell runs on Vercel.
//
// Vercel has no long-running server. It turns this file into a "serverless
// function": a copy of the app that is started when a request arrives and
// frozen again afterwards. vercel.json sends every /api/* request here, and
// the same Express app that runs locally handles it.
//
// Two things differ from server.js:
//   - there is no listen(): Vercel calls the exported handler directly;
//   - there is no Socket.io: a frozen function cannot hold a WebSocket open,
//     so on Vercel the client polls for notifications instead (see
//     client/src/realtime.jsx).
import { app } from '../server/src/app.js';
import { runMigrations } from '../server/src/migrate.js';
import { ensureJwtSecret } from '../server/src/secret.js';

// Bring the schema up to date, then load the signing secret.
const prepare = () => runMigrations().then(ensureJwtSecret);

// Started once per cold start, shared by every request this copy serves.
let ready = prepare();

export default async function handler(req, res) {
  try {
    await ready;
  } catch (err) {
    console.error('Startup failed', err);
    ready = prepare(); // let the next request try again
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ errors: { server: ['is starting up, try again in a moment'] } }));
  }
  return app(req, res);
}
