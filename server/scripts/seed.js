// Fills an empty database with demo users and articles: `npm run seed`.
// Both demo accounts use the password "password123".
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createArticle } from '../src/articles.service.js';

await runMigrations();

const existing = await pool.query('SELECT count(*)::int AS n FROM users');
if (existing.rows[0].n > 0) {
  console.log('Database already has users; skipping seed.');
  await pool.end();
  process.exit(0);
}

const hash = await bcrypt.hash('password123', 10);
const addUser = async (username, bio) =>
  (await pool.query('INSERT INTO users (username, email, password_hash, bio) VALUES ($1, $2, $3, $4) RETURNING id', [
    username,
    `${username}@example.com`,
    hash,
    bio,
  ])).rows[0].id;

const meera = await addUser('meera', 'Backend engineer. Writes about databases.');
const kabir = await addUser('kabir', 'Frontend developer and occasional illustrator.');

const posts = [
  [meera, 'Why your query is slow: a first look at indexes', 'What an index is, and when PostgreSQL decides to use one.', ['postgres', 'databases'],
    'An index is a **sorted lookup structure**. Without one, the database reads every row.\n\n## The idea\n\nThink of the index at the back of a book: you find the word, then jump to the page.\n\n```sql\nCREATE INDEX articles_author_idx ON articles (author_id);\n```\n\n> Measure first. `EXPLAIN ANALYZE` tells you what the planner really did.'],
  [meera, 'Transactions in plain words', 'All or nothing: what BEGIN and COMMIT actually promise.', ['postgres', 'backend'],
    'A transaction groups several statements so they **all succeed or all fail**.\n\n1. `BEGIN`\n2. do the work\n3. `COMMIT` (or `ROLLBACK` if anything went wrong)\n\nInkwell uses one when saving an article together with its tags.'],
  [kabir, 'Lifting state up, and when to stop', 'Where should a piece of React state live?', ['react', 'frontend'],
    'Keep state **as low as possible**, and lift it only when two components need the same value.\n\nWhen many distant components need it (like the signed-in user), reach for Context.'],
  [kabir, 'A gentle introduction to JWT', 'What is inside a JSON Web Token, and what is not.', ['auth', 'backend'],
    'A JWT has three parts: header, payload and signature.\n\nThe payload is only *encoded*, not encrypted, so never put secrets in it. The signature is what stops anyone from changing the payload.'],
  [meera, 'REST status codes you will actually use', '200, 201, 204, 400, 401, 403, 404, 409, 422.', ['backend', 'http'],
    '- **401** means "I do not know who you are".\n- **403** means "I know who you are, and you may not do this".\n- **409** means the request conflicts with existing data, such as a duplicate email.\n- **422** means the JSON was valid but the values were not.'],
  [kabir, 'Controlled inputs in React', 'Why the input value comes from state.', ['react'],
    'In a controlled input, React state is the single source of truth: `value={form.title}` and `onChange` updates the state.'],
];

for (const [author, title, description, tags, body] of posts) {
  await createArticle(author, { title, description, body, tags });
}

await pool.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)', [kabir, meera]);
console.log('Seeded 2 users and 6 articles. Sign in as meera@example.com / password123');
await pool.end();
