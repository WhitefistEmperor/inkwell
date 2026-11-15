// Fills an empty database with demo users and articles: `npm run seed`.
// Every demo account uses the password "password123".
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createArticle } from '../src/articles.service.js';
import { DEMO_PASSWORD, follows, posts, users as demoUsers } from './demo-data.js';

await runMigrations();

const existing = await pool.query('SELECT count(*)::int AS n FROM users');
if (existing.rows[0].n > 0) {
  console.log('Database already has users; skipping seed.');
  await pool.end();
  process.exit(0);
}

const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
const users = {};
for (const [username, bio] of demoUsers) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, email, password_hash, bio) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, `${username}@example.com`, hash, bio],
  );
  users[username] = rows[0].id;
}

for (const [author, title, description, tags, body] of posts) {
  await createArticle(users[author], { title, description, body, tagList: tags });
}

// Spread the publication dates over the past month, newest last in the list
// above, so the feed and the trending list have something to order.
await pool.query(`
  UPDATE articles a SET created_at = now() - (interval '22 hours' * r.n), updated_at = now() - (interval '22 hours' * r.n)
  FROM (SELECT id, (count(*) OVER ()) - row_number() OVER (ORDER BY id) AS n FROM articles) r
  WHERE a.id = r.id`);

for (const [a, b] of follows) {
  await pool.query('INSERT INTO follows (follower_id, followee_id) VALUES ($1, $2)', [users[a], users[b]]);
}

console.log(`Seeded ${Object.keys(users).length} users and ${posts.length} articles. Sign in as meera@example.com / password123`);
await pool.end();
