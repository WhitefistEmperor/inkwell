// All SQL for articles lives here; the route file only handles HTTP.
import crypto from 'node:crypto';
import { query, transaction } from './db.js';
import { HttpError } from './middleware.js';

// One query returns an article with everything the UI needs: author, tags,
// favorite count, and two viewer-specific flags. $1 is the viewer's id (or
// NULL when signed out). Doing this in SQL avoids the "N+1 problem", where a
// list of 10 articles would otherwise cost 1 + 10*4 queries.
const ARTICLE_SELECT = `
  SELECT a.id, a.slug, a.title, a.description, a.body, a.created_at, a.updated_at,
         a.author_id, u.username, u.bio, u.image,
         COALESCE((SELECT array_agg(t.name ORDER BY t.name)
                   FROM article_tags at JOIN tags t ON t.id = at.tag_id
                   WHERE at.article_id = a.id), '{}') AS tags,
         (SELECT count(*)::int FROM favorites f WHERE f.article_id = a.id) AS favorites_count,
         EXISTS (SELECT 1 FROM favorites f
                 WHERE f.article_id = a.id AND f.user_id = $1::int) AS favorited,
         EXISTS (SELECT 1 FROM follows fo
                 WHERE fo.followee_id = u.id AND fo.follower_id = $1::int) AS following
  FROM articles a JOIN users u ON u.id = a.author_id`;

// Database row (snake_case, flat) -> API response (camelCase, nested author).
function toArticle(row) {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    favorited: row.favorited,
    favoritesCount: row.favorites_count,
    author: { username: row.username, bio: row.bio, image: row.image, following: row.following },
  };
}

// "My First Post!" -> "my-first-post-x7k2p9". The random suffix keeps slugs
// unique even when two articles share a title.
function makeSlug(title) {
  const base = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${base || 'article'}-${crypto.randomBytes(4).toString('hex').slice(0, 6)}`;
}

// Builds the WHERE clause for the list endpoints. Each filter pushes its value
// onto `params` and refers to it by position, so values are never put in the SQL text.
function buildFilters(params, { tag, author, favoritedBy, feedFor }) {
  const where = [];
  if (tag) {
    params.push(tag);
    where.push(`EXISTS (SELECT 1 FROM article_tags at JOIN tags t ON t.id = at.tag_id
                        WHERE at.article_id = a.id AND t.name = $${params.length})`);
  }
  if (author) {
    params.push(author);
    where.push(`lower(u.username) = lower($${params.length})`);
  }
  if (favoritedBy) {
    params.push(favoritedBy);
    where.push(`EXISTS (SELECT 1 FROM favorites f JOIN users fu ON fu.id = f.user_id
                        WHERE f.article_id = a.id AND lower(fu.username) = lower($${params.length}))`);
  }
  if (feedFor) {
    params.push(feedFor);
    where.push(`a.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $${params.length})`);
  }
  return where.length ? `WHERE ${where.join(' AND ')}` : '';
}

export async function listArticles({ viewerId = null, limit, offset, ...filters }) {
  const params = [viewerId];
  const where = buildFilters(params, filters);
  params.push(limit, offset);
  const page = await query(
    `${ARTICLE_SELECT} ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  // Total matching rows, so the client can draw page numbers.
  const countParams = [];
  const countWhere = buildFilters(countParams, filters);
  const total = await query(
    `SELECT count(*)::int AS total FROM articles a JOIN users u ON u.id = a.author_id ${countWhere}`,
    countParams,
  );

  return { articles: page.rows.map(toArticle), total: total.rows[0].total };
}

async function findRow(slug, viewerId = null) {
  const { rows } = await query(`${ARTICLE_SELECT} WHERE a.slug = $2`, [viewerId, slug]);
  if (!rows[0]) throw new HttpError(404, 'Article not found');
  return rows[0];
}

export const getArticle = async (slug, viewerId) => toArticle(await findRow(slug, viewerId));

// Authorization: only the author may change or delete an article.
async function findOwnedRow(slug, userId) {
  const row = await findRow(slug, userId);
  if (row.author_id !== userId) throw new HttpError(403, 'You can only change your own articles');
  return row;
}

async function setTags(client, articleId, tags) {
  await client.query('DELETE FROM article_tags WHERE article_id = $1', [articleId]);
  if (!tags.length) return;
  // Create any tags that do not exist yet, then link all of them to the article.
  await client.query('INSERT INTO tags (name) SELECT unnest($1::text[]) ON CONFLICT (name) DO NOTHING', [tags]);
  await client.query(
    'INSERT INTO article_tags (article_id, tag_id) SELECT $1, id FROM tags WHERE name = ANY($2::text[])',
    [articleId, tags],
  );
}

export async function createArticle(userId, { title, description, body, tags }) {
  const slug = makeSlug(title);
  // Article + tags are written in one transaction: if tagging fails, the
  // article insert is rolled back too, so we never store half an article.
  await transaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO articles (slug, title, description, body, author_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [slug, title, description, body, userId],
    );
    await setTags(client, rows[0].id, tags);
  });
  return getArticle(slug, userId);
}

export async function updateArticle(userId, slug, { title, description, body, tags }) {
  const row = await findOwnedRow(slug, userId);
  await transaction(async (client) => {
    await client.query(
      `UPDATE articles SET
         title       = COALESCE($2, title),
         description = COALESCE($3, description),
         body        = COALESCE($4, body),
         updated_at  = now()
       WHERE id = $1`,
      [row.id, title ?? null, description ?? null, body ?? null],
    );
    if (tags) await setTags(client, row.id, tags);
  });
  // The slug is deliberately left unchanged so existing links keep working.
  return getArticle(slug, userId);
}

export async function deleteArticle(userId, slug) {
  const row = await findOwnedRow(slug, userId);
  // ON DELETE CASCADE removes its comments, favorites and tag links.
  await query('DELETE FROM articles WHERE id = $1', [row.id]);
}

export async function setFavorite(userId, slug, favorited) {
  const row = await findRow(slug, userId);
  if (favorited) {
    await query('INSERT INTO favorites (user_id, article_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, row.id]);
  } else {
    await query('DELETE FROM favorites WHERE user_id = $1 AND article_id = $2', [userId, row.id]);
  }
  return getArticle(slug, userId);
}

// ---- comments ----

const toComment = (row) => ({
  id: row.id,
  body: row.body,
  createdAt: row.created_at,
  author: { username: row.username, image: row.image },
});

export async function listComments(slug) {
  const article = await findRow(slug);
  const { rows } = await query(
    `SELECT c.id, c.body, c.created_at, u.username, u.image
     FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.article_id = $1 ORDER BY c.created_at DESC, c.id DESC`,
    [article.id],
  );
  return rows.map(toComment);
}

export async function addComment(userId, slug, body) {
  const article = await findRow(slug);
  const { rows } = await query(
    `WITH inserted AS (
       INSERT INTO comments (body, article_id, author_id) VALUES ($1, $2, $3) RETURNING *
     )
     SELECT i.id, i.body, i.created_at, u.username, u.image
     FROM inserted i JOIN users u ON u.id = i.author_id`,
    [body, article.id, userId],
  );
  return toComment(rows[0]);
}

export async function deleteComment(userId, slug, commentId) {
  const article = await findRow(slug);
  const { rows } = await query('SELECT author_id FROM comments WHERE id = $1 AND article_id = $2', [commentId, article.id]);
  if (!rows[0]) throw new HttpError(404, 'Comment not found');
  if (rows[0].author_id !== userId) throw new HttpError(403, 'You can only delete your own comments');
  await query('DELETE FROM comments WHERE id = $1', [commentId]);
}

// ---- tags ----

export async function popularTags(limit = 20) {
  const { rows } = await query(
    `SELECT t.name FROM tags t JOIN article_tags at ON at.tag_id = t.id
     GROUP BY t.name ORDER BY count(*) DESC, t.name LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.name);
}
