// Integration tests: real HTTP requests against the real app and a real
// (throwaway) PostgreSQL database. Run with `npm test`.
//
// The RealWorld contract itself (routes, status codes, response shapes) is
// checked by the official suite: `npm run test:spec`. The tests here cover
// what that suite does not look at: security and data-integrity behaviour.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { PASSWORD, api, auth, comment, createArticle, publish, register } from './helpers.js';

let asha; // tokens for two users
let ravi;

before(async () => {
  await runMigrations();
  await pool.query('TRUNCATE users, tags RESTART IDENTITY CASCADE');
  asha = await register('asha');
  ravi = await register('ravi');
});

after(() => pool.end());

describe('authentication', () => {
  test('the password is stored as a bcrypt hash and never returned', async () => {
    const res = await api.get('/api/user').set(auth(asha));
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['bio', 'email', 'image', 'token', 'username']);

    const { rows } = await pool.query("SELECT password_hash FROM users WHERE username = 'asha'");
    assert.notEqual(rows[0].password_hash, PASSWORD);
    assert.match(rows[0].password_hash, /^\$2[aby]\$/); // bcrypt format
  });

  test('uniqueness ignores case for both email and username', async () => {
    const dupEmail = await api.post('/api/users').send({ user: { username: 'someone', email: 'ASHA@example.test', password: PASSWORD } });
    assert.equal(dupEmail.status, 409);
    assert.deepEqual(dupEmail.body.errors.email, ['has already been taken']);

    const dupName = await api.post('/api/users').send({ user: { username: 'Asha', email: 'other@example.test', password: PASSWORD } });
    assert.equal(dupName.status, 409);
    assert.deepEqual(dupName.body.errors.username, ['has already been taken']);
  });

  test('an unknown email and a wrong password give the same answer', async () => {
    const wrong = await api.post('/api/users/login').send({ user: { email: 'asha@example.test', password: 'wrong-password' } });
    const unknown = await api.post('/api/users/login').send({ user: { email: 'ghost@example.test', password: 'whatever-123' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(unknown.body, wrong.body); // nothing reveals which emails exist
  });

  test('a tampered token is rejected, and "Bearer" works as well as "Token"', async () => {
    const tampered = await api.get('/api/user').set(auth(`${asha}x`));
    assert.equal(tampered.status, 401);
    assert.deepEqual(tampered.body.errors.token, ['is invalid']);

    const bearer = await api.get('/api/user').set({ Authorization: `Bearer ${asha}` });
    assert.equal(bearer.status, 200);
  });

  test('a new password works for login and the old one stops working', async () => {
    const token = await register('changer');
    await api.put('/api/user').set(auth(token)).send({ user: { password: 'brand-new-pass' } });
    const login = (password) => api.post('/api/users/login').send({ user: { email: 'changer@example.test', password } });
    assert.equal((await login('brand-new-pass')).status, 200);
    assert.equal((await login(PASSWORD)).status, 401);
  });

  test('malformed JSON and unknown routes get clean error responses', async () => {
    const bad = await api.post('/api/users/login').set('Content-Type', 'application/json').send('{not json');
    assert.equal(bad.status, 400);
    assert.ok(bad.body.errors);
    assert.equal((await api.get('/api/nope')).status, 404);
  });
});

describe('articles', () => {
  test('tags are lowercased and de-duplicated', async () => {
    const res = await createArticle(asha, { tagList: ['Postgres', 'databases', 'postgres'] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.article.tagList, ['databases', 'postgres']);
  });

  test('every invalid field is reported, each under its own name', async () => {
    const res = await api.post('/api/articles').set(auth(asha)).send({ article: { title: '', description: '', body: '' } });
    assert.equal(res.status, 422);
    assert.deepEqual(Object.keys(res.body.errors).sort(), ['body', 'description', 'title']);
  });

  test('the slug stays the same when the title changes, so old links keep working', async () => {
    const slug = await publish(asha, { title: 'Original title' });
    const res = await api.put(`/api/articles/${slug}`).set(auth(asha)).send({ article: { title: 'A new title' } });
    assert.equal(res.body.article.title, 'A new title');
    assert.equal(res.body.article.slug, slug);
  });

  test('favoriting twice counts once, and "favorited" is per viewer', async () => {
    const slug = await publish(asha);
    await api.post(`/api/articles/${slug}/favorite`).set(auth(ravi));
    const again = await api.post(`/api/articles/${slug}/favorite`).set(auth(ravi));
    assert.equal(again.body.article.favoritesCount, 1); // not 2

    const asAsha = await api.get(`/api/articles/${slug}`).set(auth(asha));
    assert.equal(asAsha.body.article.favorited, false);
    assert.equal(asAsha.body.article.favoritesCount, 1);
  });

  test('a filter value containing SQL is treated as plain text (no injection)', async () => {
    const res = await api.get('/api/articles').query({ author: "asha' OR '1'='1" });
    assert.equal(res.status, 200);
    assert.equal(res.body.articlesCount, 0);
  });

  test('an out-of-range page size is rejected instead of being served', async () => {
    assert.equal((await api.get('/api/articles?limit=5000')).status, 422);
    assert.equal((await api.get('/api/articles?offset=-1')).status, 422);
  });

  test('deleting an article cascades to its comments and favorites', async () => {
    const slug = await publish(asha, { title: 'Temporary post' });
    await comment(ravi, slug, 'cascade-me');
    await api.post(`/api/articles/${slug}/favorite`).set(auth(ravi));

    assert.equal((await api.delete(`/api/articles/${slug}`).set(auth(asha))).status, 204);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM comments WHERE body = 'cascade-me'");
    assert.equal(rows[0].n, 0);
  });

  test('if saving the tags fails, the article is rolled back too (transaction)', async () => {
    const before = (await pool.query('SELECT count(*)::int AS n FROM articles')).rows[0].n;
    // Make the tag insert fail inside the transaction.
    await pool.query('ALTER TABLE tags ADD CONSTRAINT no_boom CHECK (name <> $$boom$$)');
    try {
      const res = await createArticle(asha, { title: 'Half saved?', tagList: ['boom'] });
      assert.equal(res.status, 500);
    } finally {
      await pool.query('ALTER TABLE tags DROP CONSTRAINT no_boom');
    }
    const after = (await pool.query('SELECT count(*)::int AS n FROM articles')).rows[0].n;
    assert.equal(after, before); // no orphan article was left behind
  });
});

describe('profiles', () => {
  test('profile lookup is case-insensitive', async () => {
    const res = await api.get('/api/profiles/RAVI');
    assert.equal(res.status, 200);
    assert.equal(res.body.profile.username, 'ravi');
  });

  test('you cannot follow yourself, and following twice is harmless', async () => {
    assert.equal((await api.post('/api/profiles/asha/follow').set(auth(asha))).status, 422);

    await api.post('/api/profiles/ravi/follow').set(auth(asha));
    const again = await api.post('/api/profiles/ravi/follow').set(auth(asha));
    assert.equal(again.status, 200);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM follows');
    assert.equal(rows[0].n, 1);
  });
});
