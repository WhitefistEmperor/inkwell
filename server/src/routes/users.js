// Registration, login and the signed-in user's own account.
//   POST /api/users         register
//   POST /api/users/login   sign in
//   GET  /api/user          who am I
//   PUT  /api/user          update my account
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { HttpError, requireAuth, signToken, validate } from '../middleware.js';
import { BLANK, nullableText, requiredText } from '../schemas.js';

const router = Router();

const username = requiredText(50).regex(/^[a-zA-Z0-9_-]+$/, 'is invalid');
const email = requiredText().toLowerCase().pipe(z.email('is invalid'));
// NIST 800-63B: at least 8 characters, long passwords allowed, no composition
// rules. 72 is the most bcrypt actually reads.
const password = z
  .string({ error: BLANK })
  .min(1, BLANK)
  .min(8, 'is too short (minimum is 8 characters)')
  .max(72, 'is too long (maximum is 72 characters)');

// Every body is wrapped: { "user": { ... } }
const registerSchema = z.object({ user: z.object({ username, email, password }) });
const loginSchema = z.object({ user: z.object({ email, password: z.string({ error: BLANK }).min(1, BLANK) }) });
const updateSchema = z.object({
  user: z.object({
    username: username.optional(), // optional = may be left out, but null is rejected
    email: email.optional(),
    password: password.optional(),
    bio: nullableText().optional(),
    image: nullableText(2000).optional(),
  }),
});

// Slows down password guessing: 20 attempts per 15 minutes per IP.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skip: () => config.isTest,
  message: { errors: { request: ['too many attempts, try again later'] } },
});

// What the client may see about the signed-in user. Never the password hash.
const userResponse = (row) => ({
  user: { email: row.email, token: signToken(row.id), username: row.username, bio: row.bio, image: row.image },
});

router.post('/users', authLimiter, validate(registerSchema), async (req, res) => {
  const { username, email, password } = req.valid.body.user;
  const hash = await bcrypt.hash(password, 10); // 10 salt rounds
  // A duplicate username/email violates a unique index; errorHandler turns that into a 409.
  const { rows } = await query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
    [username, email, hash],
  );
  res.status(201).json(userResponse(rows[0]));
});

router.post('/users/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = req.valid.body.user;
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  // Same answer for "no such email" and "wrong password", so an attacker
  // cannot use this endpoint to discover which emails are registered.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new HttpError(401, { credentials: ['invalid'] });
  }
  res.json(userResponse(user));
});

router.get('/user', requireAuth, async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.userId]);
  if (!rows[0]) throw new HttpError(401, { token: ['is invalid'] });
  res.json(userResponse(rows[0]));
});

router.put('/user', requireAuth, validate(updateSchema), async (req, res) => {
  const { password, ...changes } = req.valid.body.user;
  if (password) changes.password_hash = await bcrypt.hash(password, 10);

  // Only the fields that were sent are updated. `undefined` means "not sent";
  // `null` is a real value (it clears bio or image). The column names come
  // from the schema above, never from the request, so building the SET list
  // like this is safe from SQL injection.
  const params = [req.userId];
  const sets = [];
  for (const [column, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  const { rows } = sets.length
    ? await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params)
    : await query('SELECT * FROM users WHERE id = $1', params);
  if (!rows[0]) throw new HttpError(401, { token: ['is invalid'] });
  res.json(userResponse(rows[0]));
});

export default router;
