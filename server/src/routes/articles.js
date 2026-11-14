import { Router } from 'express';
import { z } from 'zod';
import * as articles from '../articles.service.js';
import { notFoundError, optionalAuth, requireAuth, validate } from '../middleware.js';
import { requiredText } from '../schemas.js';

const router = Router();

// Tags are trimmed, lowercased and de-duplicated before they reach the database.
const tagList = z
  .array(z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{1,40}$/, 'is invalid'))
  .max(10, 'is too long (maximum is 10 tags)')
  .transform((list) => [...new Set(list)]);

const articleFields = {
  title: requiredText(200),
  description: requiredText(500),
  body: requiredText(50_000),
};

// Every body is wrapped: { "article": { ... } }
const createSchema = z.object({ article: z.object({ ...articleFields, tagList: tagList.default([]) }) });

// Same rules, but every field may be left out (a partial update). Leaving a
// field out is fine; sending null is rejected.
const updateSchema = z.object({
  article: z.object({
    title: articleFields.title.optional(),
    description: articleFields.description.optional(),
    body: articleFields.body.optional(),
    tagList: tagList.optional(),
  }),
});

const pageSchema = z.object({
  limit: z.coerce.number('is invalid').int('is invalid').min(1, 'is invalid').max(100, 'is too large (maximum is 100)').default(20),
  offset: z.coerce.number('is invalid').int('is invalid').min(0, 'is invalid').default(0),
});

const listSchema = pageSchema.extend({
  tag: z.string().trim().toLowerCase().optional(),
  author: z.string().trim().optional(),
  favorited: z.string().trim().optional(),
  q: z.string().trim().max(100).optional(), // full-text search (an Inkwell extra, not in the spec)
});

const commentSchema = z.object({ comment: z.object({ body: requiredText(2000) }) });

// Global list, with optional filters: ?tag= ?author= ?favorited= ?q= ?limit= ?offset=
router.get('/', optionalAuth, validate(listSchema, 'query'), async (req, res) => {
  const { favorited, ...rest } = req.valid.query;
  res.json(await articles.listArticles({ viewerId: req.userId, favoritedBy: favorited, ...rest }));
});

// Declared before "/:slug" so "trending" and "feed" are not mistaken for slugs.
router.get('/trending', optionalAuth, async (req, res) => {
  res.json({ articles: await articles.trendingArticles(req.userId) });
});

// Personal feed: articles by people the signed-in user follows.
router.get('/feed', requireAuth, validate(pageSchema, 'query'), async (req, res) => {
  res.json(await articles.listArticles({ viewerId: req.userId, feedFor: req.userId, ...req.valid.query }));
});

router.post('/', requireAuth, validate(createSchema), async (req, res) => {
  res.status(201).json({ article: await articles.createArticle(req.userId, req.valid.body.article) });
});

router.get('/:slug', optionalAuth, async (req, res) => {
  res.json({ article: await articles.getArticle(req.params.slug, req.userId) });
});

router.put('/:slug', requireAuth, validate(updateSchema), async (req, res) => {
  res.json({ article: await articles.updateArticle(req.userId, req.params.slug, req.valid.body.article) });
});

router.delete('/:slug', requireAuth, async (req, res) => {
  await articles.deleteArticle(req.userId, req.params.slug);
  res.status(204).end();
});

router.post('/:slug/favorite', requireAuth, async (req, res) => {
  res.json({ article: await articles.setFavorite(req.userId, req.params.slug, true) });
});

router.delete('/:slug/favorite', requireAuth, async (req, res) => {
  res.json({ article: await articles.setFavorite(req.userId, req.params.slug, false) });
});

router.get('/:slug/comments', optionalAuth, async (req, res) => {
  res.json({ comments: await articles.listComments(req.params.slug, req.userId) });
});

router.post('/:slug/comments', requireAuth, validate(commentSchema), async (req, res) => {
  const comment = await articles.addComment(req.userId, req.params.slug, req.valid.body.comment.body);
  res.status(201).json({ comment });
});

router.delete('/:slug/comments/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  // A non-numeric id cannot match any comment. Checking the article first keeps
  // the "which thing is missing" answer the same as for a numeric id.
  if (!Number.isInteger(id)) {
    await articles.getArticle(req.params.slug);
    throw notFoundError('comment');
  }
  await articles.deleteComment(req.userId, req.params.slug, id);
  res.status(204).end();
});

export default router;
