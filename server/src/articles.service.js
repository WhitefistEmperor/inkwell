// All SQL for articles, comments and tags lives here; the route file only handles HTTP.
import crypto from 'node:crypto';
import { query, transaction } from './db.js';
import { forbiddenError, notFoundError } from './middleware.js';
import { notify } from './notifications.service.js';
import { emitToArticle } from './realtime.js';

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

// Database row (snake_case, flat) -> API response (camelCase, nested author),
// in the shape the RealWorld spec defines. Lists leave the body out: it can
// be long, and a list only shows title and description.
function toArticle(row, { withBody = true } = {}) {
  return {
    slug: row.slug,
    title: row.title,
    description: row.description,
    ...(withBody ? { body: row.body } : {}),
    tagList: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    favorited: row.favorited,
    favoritesCount: row.favorites_count,
    author: { username: row.username, bio: row.bio, image: row.image, following: row.following },
    ...(row.snippet ? { snippet: row.snippet } : {}), // only present on search results
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
function buildFilters(params, { tag, author, favoritedBy, feedFor, q }) {
  const where = [];
  if (q) {
    // websearch_to_tsquery understands Google-style input: quotes, OR, -word.
    params.push(q);
    where.push(`a.search @@ websearch_to_tsquery('english', $${params.length})`);
  }
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

  // Searching changes two things: results are ordered by relevance instead of
  // date, and each result carries a snippet with the matched words marked.
  // The marks are [[ and ]] rather than HTML tags, so the frontend can
  // highlight them without ever rendering user-written HTML.
  let select = ARTICLE_SELECT;
  let orderBy = 'a.created_at DESC, a.id DESC';
  if (filters.q) {
    const tsQuery = `websearch_to_tsquery('english', $${params.indexOf(filters.q) + 1})`;
    select = ARTICLE_SELECT.replace(
      'FROM articles a',
      `, ts_headline('english', a.body, ${tsQuery}, 'StartSel=[[, StopSel=]], MaxWords=30, MinWords=12') AS snippet
       FROM articles a`,
    );
    orderBy = `ts_rank(a.search, ${tsQuery}) DESC, a.id DESC`;
  }

  params.push(limit, offset);
  const page = await query(
    `${select} ${where}
     ORDER BY ${orderBy}
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

  return {
    articles: page.rows.map((row) => toArticle(row, { withBody: false })),
    articlesCount: total.rows[0].total,
  };
}

// "Trending" = engagement that fades with age, the formula Hacker News made
// famous:  score = (favorites + 2*comments + 1) / (age_in_hours + 2)^1.5
// A comment counts double because it takes more effort than a click. The
// exponent is "gravity": it decides how fast old articles sink.
export async function trendingArticles(viewerId = null, limit = 5) {
  const { rows } = await query(
    `${ARTICLE_SELECT}
     WHERE a.created_at > now() - interval '30 days'
     ORDER BY ((SELECT count(*) FROM favorites f WHERE f.article_id = a.id)
               + 2 * (SELECT count(*) FROM comments c WHERE c.article_id = a.id) + 1)
              / power(extract(epoch FROM now() - a.created_at) / 3600 + 2, 1.5) DESC,
              a.id DESC
     LIMIT $2`,
    [viewerId, limit],
  );
  return rows.map((row) => toArticle(row, { withBody: false }));
}

async function findRow(slug, viewerId = null) {
  const { rows } = await query(`${ARTICLE_SELECT} WHERE a.slug = $2`, [viewerId, slug]);
  if (!rows[0]) throw notFoundError('article');
  return rows[0];
}

export const getArticle = async (slug, viewerId) => toArticle(await findRow(slug, viewerId));

// Authorization: only the author may change or delete an article.
async function findOwnedRow(slug, userId) {
  const row = await findRow(slug, userId);
  if (row.author_id !== userId) throw forbiddenError('article');
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

export async function createArticle(userId, { title, description, body, tagList }) {
  const slug = makeSlug(title);
  // Article + tags are written in one transaction: if tagging fails, the
  // article insert is rolled back too, so we never store half an article.
  await transaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO articles (slug, title, description, body, author_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [slug, title, description, body, userId],
    );
    await setTags(client, rows[0].id, tagList);
  });
  return getArticle(slug, userId);
}

export async function updateArticle(userId, slug, { title, description, body, tagList }) {
  const row = await findOwnedRow(slug, userId);
  await transaction(async (client) => {
    await client.query(
      `UPDATE articles SET
         title       = COALESCE($2, title),
         description = COALESCE($3, description),
         body        = COALESCE($4, body),
         updated_at  = clock_timestamp()
       WHERE id = $1`,
      [row.id, title ?? null, description ?? null, body ?? null],
    );
    // tagList left out = keep the tags; an empty array = remove them all.
    if (tagList) await setTags(client, row.id, tagList);
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
    const result = await query('INSERT INTO favorites (user_id, article_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, row.id]);
    if (result.rowCount === 1) await notify({ userId: row.author_id, actorId: userId, type: 'favorite', articleId: row.id });
  } else {
    await query('DELETE FROM favorites WHERE user_id = $1 AND article_id = $2', [userId, row.id]);
  }
  return getArticle(slug, userId);
}

// ---- comments ----

// $1 = viewer id (or NULL), used for the author's "following" flag.
const COMMENT_SELECT = `
  SELECT c.id, c.body, c.created_at, u.username, u.bio, u.image,
         EXISTS (SELECT 1 FROM follows fo
                 WHERE fo.followee_id = u.id AND fo.follower_id = $1::int) AS following
  FROM comments c JOIN users u ON u.id = c.author_id`;

const toComment = (row) => ({
  id: row.id,
  createdAt: row.created_at,
  updatedAt: row.created_at, // comments cannot be edited, so the two are always equal
  body: row.body,
  author: { username: row.username, bio: row.bio, image: row.image, following: row.following },
});

export async function listComments(slug, viewerId = null) {
  const article = await findRow(slug);
  const { rows } = await query(`${COMMENT_SELECT} WHERE c.article_id = $2 ORDER BY c.created_at DESC, c.id DESC`, [
    viewerId,
    article.id,
  ]);
  return rows.map(toComment);
}

export async function addComment(userId, slug, body) {
  const article = await findRow(slug);
  const inserted = await query('INSERT INTO comments (body, article_id, author_id) VALUES ($1, $2, $3) RETURNING id', [
    body,
    article.id,
    userId,
  ]);
  const { rows } = await query(`${COMMENT_SELECT} WHERE c.id = $2`, [userId, inserted.rows[0].id]);
  const comment = toComment(rows[0]);
  emitToArticle(slug, 'comment:new', comment); // everyone with this article open sees it appear
  await notify({ userId: article.author_id, actorId: userId, type: 'comment', articleId: article.id });
  return comment;
}

export async function deleteComment(userId, slug, commentId) {
  const article = await findRow(slug);
  const { rows } = await query('SELECT author_id FROM comments WHERE id = $1 AND article_id = $2', [commentId, article.id]);
  if (!rows[0]) throw notFoundError('comment');
  if (rows[0].author_id !== userId) throw forbiddenError('comment');
  await query('DELETE FROM comments WHERE id = $1', [commentId]);
  emitToArticle(slug, 'comment:deleted', { id: commentId });
}

// ---- tags ----

// Every tag that is in use, most used first.
export async function listTags() {
  const { rows } = await query(
    `SELECT t.name FROM tags t JOIN article_tags at ON at.tag_id = t.id
     GROUP BY t.name ORDER BY count(*) DESC, t.name`,
  );
  return rows.map((r) => r.name);
}
