// Integration tests: real HTTP requests against the real app and a real
// (throwaway) PostgreSQL database. Run with `npm test`.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';

const api = request(app);
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

async function register(username) {
  const res = await api
    .post('/api/auth/register')
    .send({ username, email: `${username}@example.test`, password: 'correct-horse-9' });
  assert.equal(res.status, 201);
  return res.body.token;
}

const draft = (overrides = {}) => ({
  title: 'Understanding database indexes',
  description: 'Why the right index makes a query fast',
  body: 'An index is a sorted lookup structure...',
  tags: ['postgres', 'databases'],
  ...overrides,
});

let asha; // tokens for two users
let ravi;

before(async () => {
  await runMigrations();
  await pool.query('TRUNCATE users, tags RESTART IDENTITY CASCADE');
  asha = await register('asha');
  ravi = await register('ravi');
});

after(() => pool.end());

describe('auth', () => {
  test('register rejects invalid input with field-level messages', async () => {
    const res = await api.post('/api/auth/register').send({ username: 'x', email: 'nope', password: 'short' });
    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.error.details).sort(), ['email', 'password', 'username']);
  });

  test('register rejects a duplicate email and a duplicate username (case-insensitive)', async () => {
    const dupEmail = await api
      .post('/api/auth/register')
      .send({ username: 'someone', email: 'ASHA@example.test', password: 'correct-horse-9' });
    assert.equal(dupEmail.status, 409);
    assert.equal(dupEmail.body.error.details.email, 'already taken');

    const dupName = await api
      .post('/api/auth/register')
      .send({ username: 'Asha', email: 'other@example.test', password: 'correct-horse-9' });
    assert.equal(dupName.status, 409);
    assert.equal(dupName.body.error.details.username, 'already taken');
  });

  test('the password hash is never returned and is not the plain password', async () => {
    const res = await api.get('/api/auth/me').set(bearer(asha));
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'asha');
    assert.equal(res.body.user.password_hash, undefined);

    const { rows } = await pool.query("SELECT password_hash FROM users WHERE username = 'asha'");
    assert.notEqual(rows[0].password_hash, 'correct-horse-9');
    assert.match(rows[0].password_hash, /^\$2[aby]\$/); // bcrypt format
  });

  test('login succeeds with the right password and fails with the wrong one', async () => {
    const ok = await api.post('/api/auth/login').send({ email: 'asha@example.test', password: 'correct-horse-9' });
    assert.equal(ok.status, 200);
    assert.ok(ok.body.token);

    const wrong = await api.post('/api/auth/login').send({ email: 'asha@example.test', password: 'wrong-password' });
    assert.equal(wrong.status, 401);

    // Unknown email gives the same answer as a wrong password.
    const unknown = await api.post('/api/auth/login').send({ email: 'ghost@example.test', password: 'whatever-123' });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.message, wrong.body.error.message);
  });

  test('protected routes reject a missing or tampered token', async () => {
    assert.equal((await api.get('/api/auth/me')).status, 401);
    assert.equal((await api.get('/api/auth/me').set(bearer(`${asha}x`))).status, 401);
    assert.equal((await api.post('/api/articles').send(draft())).status, 401);
  });

  test('a user can update their profile', async () => {
    const res = await api.put('/api/auth/me').set(bearer(ravi)).send({ bio: 'Backend developer' });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.bio, 'Backend developer');
    assert.equal(res.body.user.username, 'ravi'); // untouched fields are kept
  });
});

describe('articles', () => {
  let slug;

  test('create returns the article with a slug, tags and author', async () => {
    const res = await api.post('/api/articles').set(bearer(asha)).send(draft({ tags: ['Postgres', 'databases', 'postgres'] }));
    assert.equal(res.status, 201);
    slug = res.body.article.slug;
    assert.match(slug, /^understanding-database-indexes-[0-9a-f]{6}$/);
    assert.deepEqual(res.body.article.tags, ['databases', 'postgres']); // lowercased, de-duplicated
    assert.equal(res.body.article.author.username, 'asha');
    assert.equal(res.body.article.favoritesCount, 0);
  });

  test('create validates input', async () => {
    const res = await api.post('/api/articles').set(bearer(asha)).send({ title: '', description: '', body: '' });
    assert.equal(res.status, 422);
    assert.ok(res.body.error.details.title);
  });

  test('anyone can read an article; an unknown slug is 404', async () => {
    assert.equal((await api.get(`/api/articles/${slug}`)).status, 200);
    assert.equal((await api.get('/api/articles/no-such-article')).status, 404);
  });

  test("only the author can edit or delete (authorization)", async () => {
    const edit = await api.put(`/api/articles/${slug}`).set(bearer(ravi)).send({ title: 'Hijacked' });
    assert.equal(edit.status, 403);
    const del = await api.delete(`/api/articles/${slug}`).set(bearer(ravi));
    assert.equal(del.status, 403);
    assert.equal((await api.get(`/api/articles/${slug}`)).body.article.title, 'Understanding database indexes');
  });

  test('the author can edit; the slug stays stable and tags are replaced', async () => {
    const res = await api.put(`/api/articles/${slug}`).set(bearer(asha)).send({ title: 'Indexes, explained', tags: ['sql'] });
    assert.equal(res.status, 200);
    assert.equal(res.body.article.title, 'Indexes, explained');
    assert.equal(res.body.article.slug, slug);
    assert.deepEqual(res.body.article.tags, ['sql']);
    assert.equal(res.body.article.description, 'Why the right index makes a query fast'); // untouched
  });

  test('favorite and unfavorite are idempotent and per-user', async () => {
    await api.post(`/api/articles/${slug}/favorite`).set(bearer(ravi));
    const again = await api.post(`/api/articles/${slug}/favorite`).set(bearer(ravi));
    assert.equal(again.body.article.favoritesCount, 1); // not 2
    assert.equal(again.body.article.favorited, true);

    const asAsha = await api.get(`/api/articles/${slug}`).set(bearer(asha));
    assert.equal(asAsha.body.article.favorited, false); // Asha did not favorite it
    assert.equal(asAsha.body.article.favoritesCount, 1);

    const off = await api.delete(`/api/articles/${slug}/favorite`).set(bearer(ravi));
    assert.equal(off.body.article.favoritesCount, 0);
  });

  test('list supports tag, author and favorited filters plus pagination', async () => {
    for (let i = 1; i <= 3; i++) {
      await api.post('/api/articles').set(bearer(ravi)).send(draft({ title: `Ravi post ${i}`, tags: ['node'] }));
    }
    const all = await api.get('/api/articles');
    assert.equal(all.body.total, 4);
    assert.equal(all.body.articles[0].title, 'Ravi post 3'); // newest first

    const page = await api.get('/api/articles?limit=2&offset=2');
    assert.equal(page.body.articles.length, 2);
    assert.equal(page.body.total, 4);

    const byTag = await api.get('/api/articles?tag=node');
    assert.equal(byTag.body.total, 3);

    const byAuthor = await api.get('/api/articles?author=asha');
    assert.equal(byAuthor.body.total, 1);

    await api.post(`/api/articles/${slug}/favorite`).set(bearer(ravi));
    const favs = await api.get('/api/articles?favorited=ravi');
    assert.equal(favs.body.total, 1);
    assert.equal(favs.body.articles[0].slug, slug);

    assert.equal((await api.get('/api/articles?limit=500')).status, 422);
  });

  test('a filter value containing SQL is treated as plain text (no injection)', async () => {
    const res = await api.get('/api/articles').query({ author: "asha' OR '1'='1" });
    assert.equal(res.status, 200);
    assert.equal(res.body.total, 0);
  });

  test('popular tags are ordered by usage', async () => {
    const res = await api.get('/api/tags');
    assert.equal(res.body.tags[0], 'node'); // used by 3 articles
    assert.ok(res.body.tags.includes('sql'));
  });

  test('comments: add, list, and only the author can delete', async () => {
    const added = await api.post(`/api/articles/${slug}/comments`).set(bearer(ravi)).send({ body: 'Great explanation!' });
    assert.equal(added.status, 201);
    assert.equal(added.body.comment.author.username, 'ravi');

    const list = await api.get(`/api/articles/${slug}/comments`);
    assert.equal(list.body.comments.length, 1);

    const id = added.body.comment.id;
    assert.equal((await api.delete(`/api/articles/${slug}/comments/${id}`).set(bearer(asha))).status, 403);
    assert.equal((await api.delete(`/api/articles/${slug}/comments/${id}`).set(bearer(ravi))).status, 204);
    assert.equal((await api.get(`/api/articles/${slug}/comments`)).body.comments.length, 0);
  });

  test('deleting an article cascades to its comments and favorites', async () => {
    const created = await api.post('/api/articles').set(bearer(asha)).send(draft({ title: 'Temporary post' }));
    const temp = created.body.article.slug;
    await api.post(`/api/articles/${temp}/comments`).set(bearer(ravi)).send({ body: 'hello' });
    await api.post(`/api/articles/${temp}/favorite`).set(bearer(ravi));

    assert.equal((await api.delete(`/api/articles/${temp}`).set(bearer(asha))).status, 204);
    assert.equal((await api.get(`/api/articles/${temp}`)).status, 404);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM comments WHERE body = 'hello'");
    assert.equal(rows[0].n, 0);
  });
});

describe('profiles and feed', () => {
  test('profile lookup is public and case-insensitive', async () => {
    const res = await api.get('/api/profiles/RAVI');
    assert.equal(res.status, 200);
    assert.equal(res.body.profile.username, 'ravi');
    assert.equal(res.body.profile.following, false);
    assert.equal((await api.get('/api/profiles/nobody')).status, 404);
  });

  test('you cannot follow yourself', async () => {
    assert.equal((await api.post('/api/profiles/asha/follow').set(bearer(asha))).status, 422);
  });

  test('the feed contains only articles by people you follow', async () => {
    const empty = await api.get('/api/articles/feed').set(bearer(asha));
    assert.equal(empty.body.total, 0);

    const follow = await api.post('/api/profiles/ravi/follow').set(bearer(asha));
    assert.equal(follow.body.profile.following, true);
    await api.post('/api/profiles/ravi/follow').set(bearer(asha)); // twice is harmless

    const feed = await api.get('/api/articles/feed').set(bearer(asha));
    assert.equal(feed.body.total, 3);
    assert.ok(feed.body.articles.every((a) => a.author.username === 'ravi' && a.author.following));

    await api.delete('/api/profiles/ravi/follow').set(bearer(asha));
    assert.equal((await api.get('/api/articles/feed').set(bearer(asha))).body.total, 0);
    assert.equal((await api.get('/api/articles/feed')).status, 401);
  });
});

test('unknown routes and malformed JSON get clean error responses', async () => {
  assert.equal((await api.get('/api/nope')).status, 404);
  const bad = await api.post('/api/auth/login').set('Content-Type', 'application/json').send('{not json');
  assert.equal(bad.status, 400);
});
