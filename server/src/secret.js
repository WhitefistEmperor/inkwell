// Where the JWT signing secret comes from.
//
// 1. If the JWT_SECRET environment variable is set, that is used.
// 2. Otherwise the app creates a random 256-bit secret the first time it
//    starts and stores it in the database, so every copy of the server (and
//    every restart) signs and verifies tokens with the same key.
//
// Why this is acceptable: anyone who can read the app_secrets table can
// already read and change every user and article, so keeping the key there
// does not give an attacker anything new. The key never leaves the server.
import crypto from 'node:crypto';
import { config } from './config.js';
import { query } from './db.js';

export async function ensureJwtSecret() {
  if (config.jwtSecret) return;

  // If two copies start at once, both try to insert; ON CONFLICT lets exactly
  // one win, and both then read back the same stored value.
  await query("INSERT INTO app_secrets (name, value) VALUES ('jwt_secret', $1) ON CONFLICT (name) DO NOTHING", [
    crypto.randomBytes(32).toString('hex'),
  ]);
  const { rows } = await query("SELECT value FROM app_secrets WHERE name = 'jwt_secret'");
  config.jwtSecret = rows[0].value;
}
