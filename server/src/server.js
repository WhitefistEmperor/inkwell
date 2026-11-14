import http from 'node:http';
import { app } from './app.js';
import { config } from './config.js';
import { runMigrations } from './migrate.js';
import { attachRealtime } from './realtime.js';

await runMigrations(); // make sure the schema is up to date before serving

// Express handles normal HTTP requests; Socket.io shares the same server and
// port, and takes over the connections that upgrade to WebSocket.
const server = http.createServer(app);
attachRealtime(server);

server.listen(config.port, () => {
  console.log(`Inkwell API listening on http://localhost:${config.port}`);
});
