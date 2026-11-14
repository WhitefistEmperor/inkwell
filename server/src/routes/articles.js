import { Router } from 'express';
import { z } from 'zod';
import * as articles from '../articles.service.js';
import { HttpError, optionalAuth, requireAuth, validate } from '../middleware.js';

const router = Router();

// Tags are trimmed, lowercased and de-duplicated before they reach the database.
const tags = z
  .array(z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,24}$/, 'Tags use letters, numbers and dashes'))
  .max(8, 'At most 8 tags')
  .transform((list) => [...new Set(list)]);

const createSchema = z.object({
  title: z.string().trim().min(3, 'At least 3 characters').max(120),
  description: z.string().trim().min(3, 'At least 3 characters').max(240),
  body: z.string().trim().min(1, 'Required').max(50_000),
  tags: tags.default([]),
});

// Same rules, but every field optional (a partial update).
const updateSchema = createSchema.partial().extend({ tags: tags.optional() });

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  offset: z.coerce.number().int().min(0).default(0),
});

const listSchema = pageSchema.extend({
  tag: z.string().trim().toLowerCase().optional(),
  author: z.string().trim().optional(),
  favorited: z.string().trim().optional(),
});

const commentSchema = z.object({ body: z.string().trim().min(1, 'Required').max(2000) });

// Global list, with optional filters: ?tag= ?author= ?favorited= ?limit= ?offset=
router.get('/', optionalAuth, validate(listSchema, 'query'), async (req, res) => {
  const { favorited, ...rest } = req.valid.query;
  res.json(await articles.listArticles({ viewerId: req.userId, favoritedBy: favorited, ...rest }));
});

// Personal feed: articles by people the signed-in user follows.
// Declared before "/:slug" so "feed" is not mistaken for a slug.
router.get('/feed', requireAuth, validate(pageSchema, 'query'), async (req, res) => {
  res.json(await articles.listArticles({ viewerId: req.userId, feedFor: req.userId, ...req.valid.query }));
});

router.post('/', requireAuth, validate(createSchema), async (req, res) => {
  res.status(201).json({ article: await articles.createArticle(req.userId, req.valid.body) });
});

router.get('/:slug', optionalAuth, async (req, res) => {
  res.json({ article: await articles.getArticle(req.params.slug, req.userId) });
});

router.put('/:slug', requireAuth, validate(updateSchema), async (req, res) => {
  res.json({ article: await articles.updateArticle(req.userId, req.params.slug, req.valid.body) });
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

router.get('/:slug/comments', async (req, res) => {
  res.json({ comments: await articles.listComments(req.params.slug) });
});

router.post('/:slug/comments', requireAuth, validate(commentSchema), async (req, res) => {
  res.status(201).json({ comment: await articles.addComment(req.userId, req.params.slug, req.valid.body.body) });
});

router.delete('/:slug/comments/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new HttpError(404, 'Comment not found');
  await articles.deleteComment(req.userId, req.params.slug, id);
  res.status(204).end();
});

export default router;
