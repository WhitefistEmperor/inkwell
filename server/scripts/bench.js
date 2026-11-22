// Load benchmark at a realistic size.
//
//   npm --prefix server run bench -- [label]
//
// Runs inside `with-db.js test`, so it gets a throwaway PostgreSQL. It then:
//   1. seeds 10,000 users, 100,000 articles (~150-word bodies), 300,000 tag links,
//      ~500,000 favorites, 300,000 comments and ~300,000 follows, all in SQL;
//   2. starts the real server (src/server.js) as a separate process;
//   3. hammers each read endpoint with autocannon (20 connections, 10 s each)
//      and records throughput and latency percentiles;
//   4. measures WebSocket fan-out: 200 readers on one article, time from posting
//      a comment over HTTP to each reader receiving it;
//   5. writes bench/results-<label>.json.
//
// The numbers depend on the machine; compare runs from the same machine only.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import autocannon from 'autocannon';
import jwt from 'jsonwebtoken';
import pg from 'pg';
import { io as ioClient } from 'socket.io-client';

const label = process.argv[2] || 'run';
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DURATION = Number(process.env.BENCH_DURATION || 10);
const CONNECTIONS = 20;
const SIZE = { users: 10_000, articles: 100_000, tags: 100, commentsPerArticle: 3, followsPerUser: 30, favorites: 500_000 };
const SECRET = 'bench-secret';

const WORDS = `the of and to in is that for it as with was on be by this are from at or an have not
  which but they all one their there been has were more when will would can if no other into its time
  only new some could these two may first then do any like my now over such our man me even most made
  after also did many before must through back years where much your way well down should because each
  just those people how too little state good very make world still own see men work long get here
  between both life being under never day same another know while last might us great old year off
  come since against go came right used take three postgres index query latency cache vector search
  socket stream kernel thread memory compiler graph router tensor gradient database schema migration
  replica shard partition queue broker lambda container cluster deploy rollback canary payload webhook
  token session cookie header proxy gateway endpoint mutex semaphore deadlock garbage heap stack lexer
  parser bytecode interpreter runtime monad closure iterator generator coroutine promise async await
  react render hydrate bundle module package library framework typescript javascript python rust golang
  haskell erlang elixir clojure kotlin swift android linux windows macos firmware sensor robot drone
  satellite orbit rocket telescope galaxy quantum photon electron neutron proton entropy enzyme protein
  genome neuron synapse cortex vaccine virus bacteria climate carbon solar wind battery lithium grid
  market inflation interest equity bond startup founder investor revenue margin pricing churn growth
  design typography colour layout grid spacing contrast accessibility keyboard screen reader mobile
  coffee tea bread pasta garden river mountain forest ocean desert island village city train bicycle
  football cricket chess music guitar piano violin poetry novel essay journal notebook pencil ink`.split(/\s+/).filter(Boolean);

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

async function seed(db) {
  const t0 = Date.now();
  await db.query(`SET synchronous_commit = off`);
  await db.query(`
    INSERT INTO users (username, email, password_hash, bio)
    SELECT 'user' || i, 'user' || i || '@bench.test', 'x', 'bio of user ' || i FROM generate_series(1, $1) i`, [SIZE.users]);
  await db.query(`CREATE OR REPLACE FUNCTION hashint(i int) RETURNS int IMMUTABLE LANGUAGE sql AS $$ SELECT abs(hashtext(i::text)) $$`);
  await db.query(`INSERT INTO tags (name) SELECT 'tag' || i FROM generate_series(1, $1) i`, [SIZE.tags]);
  // Words are drawn with a skewed distribution (random()^2) so that some are
  // common and some rare, as in real text. Articles span the last 365 days.
  await db.query(`
    INSERT INTO articles (slug, title, description, body, author_id, created_at, updated_at)
    SELECT 'article-' || i,
           initcap(w.t), 'about ' || w.d, b.body,
           1 + (hashint(i) % $2),
           now() - (random() * interval '365 days'), now()
    FROM generate_series(1, $1) i
    CROSS JOIN LATERAL (
      SELECT string_agg(($3::text[])[1 + floor(power(random(), 2) * array_length($3::text[], 1))::int], ' ') AS body
      FROM generate_series(1, 120 + i % 60)) b
    CROSS JOIN LATERAL (
      SELECT string_agg(($3::text[])[1 + floor(power(random(), 2) * array_length($3::text[], 1))::int], ' ') FILTER (WHERE g <= 5 + i % 3) AS t,
             string_agg(($3::text[])[1 + floor(random() * array_length($3::text[], 1))::int], ' ') AS d
      FROM generate_series(1, 12 + i % 2) g) w`,
  [SIZE.articles, SIZE.users, WORDS]);
  await db.query(`
    INSERT INTO article_tags (article_id, tag_id)
    SELECT a.id, 1 + floor(power(random(), 1.5) * $1)::int FROM articles a, generate_series(1, 3)
    ON CONFLICT DO NOTHING`, [SIZE.tags]);
  await db.query(`
    INSERT INTO favorites (user_id, article_id)
    SELECT 1 + floor(random() * $1)::int, 1 + floor(power(random(), 2) * $2)::int FROM generate_series(1, $3)
    ON CONFLICT DO NOTHING`, [SIZE.users, SIZE.articles, SIZE.favorites]);
  await db.query(`
    INSERT INTO comments (body, article_id, author_id, created_at)
    SELECT 'comment ' || g, a.id, 1 + floor(random() * $1)::int, a.created_at + random() * interval '3 days'
    FROM articles a, generate_series(1, $2) g`, [SIZE.users, SIZE.commentsPerArticle]);
  await db.query(`
    INSERT INTO follows (follower_id, followee_id)
    SELECT follower_id, followee_id FROM (
      SELECT u.id AS follower_id, 1 + floor(power(random(), 2) * $1)::int AS followee_id
      FROM users u, generate_series(1, $2)) f
    WHERE follower_id <> followee_id
    ON CONFLICT DO NOTHING`, [SIZE.users, SIZE.followsPerUser]);
  await db.query('VACUUM ANALYZE');
  return { counts: await counts(db), seconds: (Date.now() - t0) / 1000 };
}

async function counts(db) {
  const out = {};
  for (const t of ['users', 'articles', 'article_tags', 'favorites', 'comments', 'follows']) {
    out[t] = (await db.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
  }
  return out;
}

async function waitFor(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not start: ${url}`);
}

function load(url, headers = {}) {
  return new Promise((resolve, reject) => {
    autocannon({ url, connections: CONNECTIONS, duration: DURATION, headers }, (err, r) => {
      if (err) return reject(err);
      resolve({
        requests_per_s: Math.round(r.requests.average),
        latency_ms: { p50: r.latency.p50, p90: r.latency.p90, p99: r.latency.p99, max: r.latency.max },
        non_2xx: r.non2xx, errors: r.errors, timeouts: r.timeouts,
      });
    });
  });
}

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

async function fanout(base, slug, token, readers = 200, rounds = 20) {
  const sockets = await Promise.all(Array.from({ length: readers }, () => new Promise((resolve, reject) => {
    const s = ioClient(base, { transports: ['websocket'], forceNew: true });
    s.on('connect', () => { s.emit('article:join', slug); resolve(s); });
    s.on('connect_error', reject);
  })));
  await new Promise((r) => setTimeout(r, 500)); // let every join land
  const delays = [];
  for (let i = 0; i < rounds; i++) {
    const body = `fanout ${i} ${Date.now()}`;
    const t0 = performance.now();
    const got = Promise.all(sockets.map((s) => new Promise((resolve) => {
      const on = (c) => { if (c?.body === body || c?.comment?.body === body) { s.off('comment:new', on); resolve(performance.now() - t0); } };
      s.on('comment:new', on);
    })));
    const res = await fetch(`${base}/api/articles/${slug}/comments`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Token ${token}` },
      body: JSON.stringify({ comment: { body } }),
    });
    if (!res.ok) throw new Error(`comment failed: ${res.status}`);
    delays.push(...(await got));
  }
  sockets.forEach((s) => s.close());
  return { readers, comments: rounds, deliveries: delays.length,
           latency_ms: { p50: +pct(delays, 50).toFixed(1), p95: +pct(delays, 95).toFixed(1), p99: +pct(delays, 99).toFixed(1) } };
}

async function main() {
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  // Migrations run when the server starts; run them here first so we can seed.
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), JWT_SECRET: SECRET, NODE_ENV: 'production', CLIENT_ORIGIN: '*' };
  const server = spawn(process.execPath, ['src/server.js'], { cwd: serverDir, env, stdio: ['ignore', 'inherit', 'inherit'] });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(`${base}/api/health`);
    // Reuse an already-seeded database (e.g. the dev one) instead of seeding twice.
    const existing = (await db.query('SELECT count(*)::int AS n FROM articles')).rows[0].n;
    const seeded = existing >= SIZE.articles ? { counts: await counts(db), seconds: 0 } : await seed(db);
    console.log('seeded', seeded);
    // The viewer is a user who follows 30 people, as a signed-in reader would.
    const viewer = (await db.query(`SELECT follower_id AS id FROM follows GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`)).rows[0].id;
    const token = jwt.sign({ sub: String(viewer) }, SECRET, { expiresIn: '1h' });
    const auth = { authorization: `Token ${token}` };
    const popular = (await db.query(`SELECT a.slug, u.username FROM articles a JOIN users u ON u.id = a.author_id
                                     ORDER BY (SELECT count(*) FROM favorites f WHERE f.article_id = a.id) DESC LIMIT 1`)).rows[0];
    const endpoints = {
      'GET /articles (global, page 1)': [`${base}/api/articles?limit=20`],
      'GET /articles (signed in)': [`${base}/api/articles?limit=20`, auth],
      'GET /articles?offset=5000 (deep page)': [`${base}/api/articles?limit=20&offset=5000`],
      'GET /articles?tag=': [`${base}/api/articles?tag=tag50&limit=20`],
      'GET /articles?author=': [`${base}/api/articles?author=${popular.username}&limit=20`],
      'GET /articles?favorited=': [`${base}/api/articles?favorited=user1&limit=20`],
      'GET /articles/feed': [`${base}/api/articles/feed?limit=20`, auth],
      'GET /articles?q= (common word)': [`${base}/api/articles?q=postgres&limit=20`],
      'GET /articles?q= (rare words)': [`${base}/api/articles?q=${encodeURIComponent('violin telescope')}&limit=20`],
      'GET /articles/trending': [`${base}/api/articles/trending`],
      'GET /tags': [`${base}/api/tags`],
      'GET /articles/:slug': [`${base}/api/articles/${popular.slug}`, auth],
      'GET /articles/:slug/comments': [`${base}/api/articles/${popular.slug}/comments`],
    };
    const results = {};
    for (const [name, [url, headers]] of Object.entries(endpoints)) {
      results[name] = await load(url, headers);
      console.log(name.padEnd(42), results[name].requests_per_s, 'req/s', 'p50', results[name].latency_ms.p50, 'p99', results[name].latency_ms.p99);
    }
    const realtime = await fanout(base, popular.slug, token);
    console.log('fan-out', realtime);
    const out = {
      label, date: new Date().toISOString(),
      machine: { cpus: os.cpus().length, cpu: os.cpus()[0].model, node: process.version, platform: process.platform },
      load: { connections: CONNECTIONS, seconds_per_endpoint: DURATION },
      data: seeded.counts, seed_seconds: seeded.seconds, endpoints: results, realtime,
    };
    fs.mkdirSync(path.join(serverDir, 'bench'), { recursive: true });
    const file = path.join(serverDir, 'bench', `results-${label}.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`written: ${file}`);
  } finally {
    server.kill();
    await db.end();
  }
}

await main();
