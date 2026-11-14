// Shared by the test files: small wrappers around the RealWorld request shapes.
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from '../src/app.js';

export const api = request(app);
export const auth = (token) => ({ Authorization: `Token ${token}` });

export const PASSWORD = 'correct-horse-9';

// Registers a user and returns their token.
export async function register(username) {
  const res = await api
    .post('/api/users')
    .send({ user: { username, email: `${username}@example.test`, password: PASSWORD } });
  assert.equal(res.status, 201);
  return res.body.user.token;
}

// Publishes an article and returns the whole response.
export function createArticle(token, article = {}) {
  return api
    .post('/api/articles')
    .set(auth(token))
    .send({ article: { title: 'A title', description: 'A short description', body: 'Some body text', ...article } });
}

// Publishes an article and returns its slug.
export async function publish(token, article) {
  const res = await createArticle(token, article);
  assert.equal(res.status, 201);
  return res.body.article.slug;
}

export const comment = (token, slug, body) =>
  api.post(`/api/articles/${slug}/comments`).set(auth(token)).send({ comment: { body } });
