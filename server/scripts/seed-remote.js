// Loads the demo content into a RUNNING Inkwell (for example the Vercel
// deployment) using only its public API, so no database password is needed.
//
//   node scripts/seed-remote.js https://inkwell-xi-three.vercel.app
//
// It refuses to run if the site already has articles.
import { DEMO_PASSWORD, follows, posts, users } from './demo-data.js';

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node scripts/seed-remote.js <site address>');
  process.exit(1);
}

// A serverless site can need a few seconds (or a retry) on its first request.
async function call(path, { method = 'GET', body, token } = {}, attempt = 1) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Token ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if ([500, 502, 503].includes(res.status) && attempt < 6) {
    await new Promise((r) => setTimeout(r, 4000));
    return call(path, { method, body, token }, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const existing = await call('/api/articles?limit=1');
if (existing.articlesCount > 0) {
  console.log(`The site already has ${existing.articlesCount} articles; nothing to do.`);
  process.exit(0);
}

const tokens = {};
for (const [username, bio] of users) {
  const email = `${username}@example.com`;
  const { user } = await call('/api/users', { method: 'POST', body: { user: { username, email, password: DEMO_PASSWORD } } });
  tokens[username] = user.token;
  await call('/api/user', { method: 'PUT', token: user.token, body: { user: { bio } } });
}

for (const [author, title, description, tags, body] of posts) {
  await call('/api/articles', { method: 'POST', token: tokens[author], body: { article: { title, description, body, tagList: tags } } });
}
for (const [follower, followee] of follows) {
  await call(`/api/profiles/${followee}/follow`, { method: 'POST', token: tokens[follower] });
}

console.log(`Loaded ${users.length} users and ${posts.length} articles into ${base}`);
