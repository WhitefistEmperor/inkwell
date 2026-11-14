import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { HttpError, requireAuth, signToken, validate } from '../middleware.js';

const router = Router();

const username = z.string().trim().regex(/^[a-zA-Z0-9_]{3,20}$/, '3-20 letters, numbers or underscores');
const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'));
const password = z.string().min(8, 'At least 8 characters').max(72, 'At most 72 characters'); // bcrypt reads only 72 bytes

const registerSchema = z.object({ username, email, password });
const loginSchema = z.object({ email, password: z.string().min(1, 'Required') });
const updateSchema = z.object({
  username: username.optional(),
  email: email.optional(),
  password: password.optional(),
  bio: z.string().trim().max(500).optional(),
  image: z.union([z.literal(''), z.url('Enter a valid URL')]).optional(),
});

// Slows down password guessing: 20 attempts per 15 minutes per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: () => config.isTest,
  message: { error: { message: 'Too many attempts, try again later' } },
});

// What the client is allowed to see about the signed-in user (no password_hash).
const publicUser = (row) => ({ id: row.id, username: row.username, email: row.email, bio: row.bio, image: row.image });

router.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
  const { username, email, password } = req.valid.body;
  const hash = await bcrypt.hash(password, 10); // 10 salt rounds
  // A duplicate username/email violates a unique index; errorHandler turns that into a 409.
  const { rows } = await query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
    [username, email, hash],
  );
  res.status(201).json({ user: publicUser(rows[0]), token: signToken(rows[0].id) });
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.valid.body;
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  // Same message for "no such email" and "wrong password", so an attacker
  // cannot use this endpoint to discover which emails are registered.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  res.json({ user: publicUser(user), token: signToken(user.id) });
});

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) throw new HttpError(401, 'Sign in required');
  res.json({ user: publicUser(rows[0]) });
});

router.put('/me', requireAuth, validate(updateSchema), async (req, res) => {
  const { username, email, password, bio, image } = req.valid.body;
  const hash = password ? await bcrypt.hash(password, 10) : null;
  // COALESCE keeps the existing value when a field was not sent (NULL).
  const { rows } = await query(
    `UPDATE users SET
       username      = COALESCE($2, username),
       email         = COALESCE($3, email),
       password_hash = COALESCE($4, password_hash),
       bio           = COALESCE($5, bio),
       image         = COALESCE($6, image)
     WHERE id = $1 RETURNING *`,
    [req.userId, username ?? null, email ?? null, hash, bio ?? null, image ?? null],
  );
  if (!rows[0]) throw new HttpError(401, 'Sign in required');
  res.json({ user: publicUser(rows[0]) });
});

export default router;
