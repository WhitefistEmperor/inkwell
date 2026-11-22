// Tests for search, trending, notifications and the WebSocket layer.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { io as connect } from 'socket.io-client';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { attachRealtime } from '../src/realtime.js';
import { api, auth, comment, publish, register } from './helpers.js';
import { app } from '../src/app.js';
import { SEARCH_CAP } from '../src/articles.service.js';
import { config } from '../src/config.js';

let asha;
let ravi;
let server; // a real HTTP server, needed only for the WebSocket tests
let socketUrl;
const sockets = [];

// Opens a socket and waits until it is connected.
function openSocket(token) {
  return new Promise((resolve, reject) => {
    const socket = connect(socketUrl, { auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

// Resolves with the next `event` payload, or rejects after `ms`.
function nextEvent(socket, event, ms = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no "${event}" event within ${ms}ms`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

before(async () => {
  await runMigrations();
  await pool.query('TRUNCATE users, tags RESTART IDENTITY CASCADE');
  asha = await register('asha');
  ravi = await register('ravi');

  server = http.createServer(app);
  attachRealtime(server);
  await new Promise((resolve) => server.listen(0, resolve)); // port 0 = any free port
  socketUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  sockets.forEach((s) => s.close());
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

describe('full-text search', () => {
  before(async () => {
    await publish(asha, { title: 'Cooking rice at home', body: 'Wash the rice, then simmer. Indexing is mentioned once here.' });
    await publish(asha, { title: 'Database indexing explained', body: 'An index speeds up lookups.' });
    await publish(ravi, { title: 'Travel notes', body: 'Nothing about databases in this one.' });
  });

  test('a title match ranks above a body match', async () => {
    const res = await api.get('/api/articles').query({ q: 'indexing' });
    assert.equal(res.status, 200);
    assert.equal(res.body.articlesCount, 2);
    assert.equal(res.body.articles[0].title, 'Database indexing explained');
    assert.equal(res.body.articles[1].title, 'Cooking rice at home');
  });

  test('stemming: searching "indexes" finds "index" and "indexing"', async () => {
    const res = await api.get('/api/articles').query({ q: 'indexes' });
    assert.equal(res.body.articlesCount, 2);
  });

  test('results carry a snippet with the matched word marked', async () => {
    const res = await api.get('/api/articles').query({ q: 'simmer' });
    assert.equal(res.body.articlesCount, 1);
    assert.match(res.body.articles[0].snippet, /\[\[simmer\]\]/);
  });

  test('normal lists have no snippet, and a search with no match is empty', async () => {
    assert.equal((await api.get('/api/articles')).body.articles[0].snippet, undefined);
    assert.equal((await api.get('/api/articles').query({ q: 'xylophone' })).body.articlesCount, 0);
  });

  test('search combines with other filters', async () => {
    const res = await api.get('/api/articles').query({ q: 'databases', author: 'ravi' });
    assert.equal(res.body.articlesCount, 1);
    assert.equal(res.body.articles[0].title, 'Travel notes');
  });

  test('editing an article updates the search index automatically', async () => {
    const slug = await publish(ravi, { title: 'Untitled draft', body: 'placeholder' });
    await api.put(`/api/articles/${slug}`).set(auth(ravi)).send({ article: { body: 'Now it mentions kubernetes.' } });
    const res = await api.get('/api/articles').query({ q: 'kubernetes' });
    assert.equal(res.body.articlesCount, 1);
  });
});

describe('trending', () => {
  test('engagement lifts an article, and age pulls it back down', async () => {
    const quiet = await publish(asha, { title: 'Quiet newest post', body: 'nobody reacted' });
    const loved = await publish(asha, { title: 'Loved post', body: 'people reacted' });
    await api.post(`/api/articles/${loved}/favorite`).set(auth(ravi));
    await comment(ravi, loved, 'great');

    let res = await api.get('/api/articles/trending');
    assert.equal(res.status, 200);
    assert.equal(res.body.articles[0].slug, loved);
    assert.ok(res.body.articles.length <= 5);

    // Pretend the loved post is 3 days old: the fresh one should overtake it.
    await pool.query("UPDATE articles SET created_at = now() - interval '3 days' WHERE slug = $1", [loved]);
    res = await api.get('/api/articles/trending');
    const order = res.body.articles.map((a) => a.slug);
    assert.ok(order.indexOf(quiet) < order.indexOf(loved) || !order.includes(loved));
  });
});

describe('notifications', () => {
  let slug;

  before(async () => {
    await pool.query('TRUNCATE notifications');
    slug = await publish(asha, { title: 'Notify me', body: 'body' });
  });

  test('follow, favorite and comment each notify the other user once', async () => {
    await api.post('/api/profiles/asha/follow').set(auth(ravi));
    await api.post('/api/profiles/asha/follow').set(auth(ravi)); // repeat: no second notification
    await api.post(`/api/articles/${slug}/favorite`).set(auth(ravi));
    await api.post(`/api/articles/${slug}/favorite`).set(auth(ravi)); // repeat
    await comment(ravi, slug, 'hello');

    const res = await api.get('/api/notifications').set(auth(asha));
    assert.equal(res.status, 200);
    assert.equal(res.body.unread, 3);
    assert.deepEqual(res.body.notifications.map((n) => n.type), ['comment', 'favorite', 'follow']); // newest first
    assert.equal(res.body.notifications[0].actor.username, 'ravi');
    assert.equal(res.body.notifications[0].article.slug, slug);
    assert.equal(res.body.notifications[2].article, null); // a follow has no article
  });

  test('your own actions do not notify you', async () => {
    await api.post(`/api/articles/${slug}/favorite`).set(auth(asha));
    await comment(asha, slug, 'my own comment');
    assert.equal((await api.get('/api/notifications').set(auth(asha))).body.unread, 3);
  });

  test('notifications are private and require signing in', async () => {
    assert.equal((await api.get('/api/notifications')).status, 401);
    assert.equal((await api.get('/api/notifications').set(auth(ravi))).body.notifications.length, 0);
  });

  test('mark all as read', async () => {
    assert.equal((await api.post('/api/notifications/read').set(auth(asha))).status, 204);
    const res = await api.get('/api/notifications').set(auth(asha));
    assert.equal(res.body.unread, 0);
    assert.ok(res.body.notifications.every((n) => n.read));
  });
});

describe('realtime (WebSocket)', () => {
  let slug;

  before(async () => {
    slug = await publish(asha, { title: 'Live article', body: 'body' });
  });

  test('a notification is pushed to the recipient the moment it happens', async () => {
    const ashaSocket = await openSocket(asha);
    const pushed = nextEvent(ashaSocket, 'notification');
    await api.post(`/api/articles/${slug}/favorite`).set(auth(ravi));
    const notification = await pushed;
    assert.equal(notification.type, 'favorite');
    assert.equal(notification.actor.username, 'ravi');
  });

  test('nobody else receives it: not another user, not an anonymous socket, not a forged token', async () => {
    const raviSocket = await openSocket(ravi);
    const anonymous = await openSocket(undefined);
    const forged = await openSocket(`${asha}tampered`);
    const leaked = [];
    for (const s of [raviSocket, anonymous, forged]) s.on('notification', (n) => leaked.push(n));

    const ashaSocket = await openSocket(asha);
    const pushed = nextEvent(ashaSocket, 'notification');
    await comment(ravi, slug, 'for asha only');
    await pushed;
    await new Promise((resolve) => setTimeout(resolve, 150)); // give a leak time to show up
    assert.equal(leaked.length, 0);
  });

  test('readers of an article see new and deleted comments live', async () => {
    const reader = await openSocket(undefined); // signed-out readers get live comments too
    reader.emit('article:join', slug);
    await new Promise((resolve) => setTimeout(resolve, 100)); // let the join reach the server

    const added = nextEvent(reader, 'comment:new');
    const res = await comment(ravi, slug, 'live!');
    assert.equal((await added).body, 'live!');

    const removed = nextEvent(reader, 'comment:deleted');
    await api.delete(`/api/articles/${slug}/comments/${res.body.comment.id}`).set(auth(ravi));
    assert.equal((await removed).id, res.body.comment.id);
  });

  test('a socket that has not joined an article room hears nothing about it', async () => {
    const outsider = await openSocket(ravi);
    let heard = false;
    outsider.on('comment:new', () => (heard = true));
    await comment(asha, slug, 'quiet');
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(heard, false);
  });
});

describe('caching and search limits', () => {
  test('the tag list is cached, yet a new article shows its tags at once', async () => {
    const saved = config.cacheMs;
    config.cacheMs = 60_000;
    try {
      await api.get('/api/tags'); // fills the cache
      await publish(asha, { title: 'Fresh tags', body: 'tagged', tagList: ['freshtag'] });
      assert.ok((await api.get('/api/tags')).body.tags.includes('freshtag'));
    } finally {
      config.cacheMs = saved;
    }
  });

  test('trending reuses its cached ranking until the cache expires', async () => {
    const saved = config.cacheMs;
    config.cacheMs = 60_000;
    try {
      config.cacheMs = 0;
      await api.get('/api/articles/trending'); // refreshes the ranking now
      config.cacheMs = 60_000;
      const before = (await api.get('/api/articles/trending')).body.articles.map((a) => a.slug);
      const hot = await publish(ravi, { title: 'Instant hit', body: 'hot' });
      await api.post(`/api/articles/${hot}/favorite`).set(auth(asha));
      const cached = (await api.get('/api/articles/trending')).body.articles.map((a) => a.slug);
      assert.deepEqual(cached, before);
      assert.ok(!cached.includes(hot));
      config.cacheMs = 0;
      const fresh = (await api.get('/api/articles/trending')).body.articles.map((a) => a.slug);
      assert.ok(fresh.includes(hot));
    } finally {
      config.cacheMs = saved;
    }
  });

  test('a search counts and ranks at most SEARCH_CAP of the newest matches', async () => {
    const values = Array.from({ length: SEARCH_CAP + 5 }, (_, i) => i);
    const { rows: [user] } = await pool.query("SELECT id FROM users WHERE username = 'asha'");
    await pool.query(
      `INSERT INTO articles (slug, title, description, body, author_id, created_at)
       SELECT 'capword-' || i, 'capword ' || i, 'd', 'capword body', $1, now() - i * interval '1 minute'
       FROM unnest($2::int[]) i`, [user.id, values]);
    try {
      const res = await api.get('/api/articles').query({ q: 'capword', limit: 20 });
      assert.equal(res.body.articlesCount, SEARCH_CAP);
      const last = await api.get('/api/articles').query({ q: 'capword', limit: 20, offset: SEARCH_CAP });
      assert.equal(last.body.articles.length, 0); // the 5 oldest matches are past the cap
    } finally {
      await pool.query("DELETE FROM articles WHERE slug LIKE 'capword-%'");
    }
  });
});
