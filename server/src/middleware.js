import jwt from 'jsonwebtoken';
import { config } from './config.js';

// An error that carries an HTTP status. Routes throw it; errorHandler formats it.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

// Returns the user id inside a valid token, or null. Used by both the HTTP
// middleware below and the WebSocket handshake in realtime.js.
export function verifyToken(token) {
  if (!token) return null;
  try {
    return Number(jwt.verify(token, config.jwtSecret).sub);
  } catch {
    return null; // expired, tampered or malformed
  }
}

// Reads "Authorization: Bearer <token>". Returns the user id, or null.
function userIdFromRequest(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' ? verifyToken(token) : null;
}

// Authentication: who are you? Protected routes use requireAuth.
export function requireAuth(req, res, next) {
  req.userId = userIdFromRequest(req);
  if (!req.userId) return next(new HttpError(401, 'Sign in required'));
  next();
}

// Public routes that show extra information when signed in
// (e.g. whether *you* favorited an article) use optionalAuth.
export function optionalAuth(req, res, next) {
  req.userId = userIdFromRequest(req);
  next();
}

// Validates req.body / req.query against a zod schema before the route runs.
// The cleaned result is placed on req.valid, so routes never read raw input.
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const details = {};
    for (const issue of result.error.issues) {
      details[issue.path.join('.') || source] = issue.message;
    }
    return next(new HttpError(422, 'Validation failed', details));
  }
  req.valid = { ...req.valid, [source]: result.data };
  next();
};

export function notFound(req, res, next) {
  next(new HttpError(404, 'Not found'));
}

// One place decides what every error response looks like.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // PostgreSQL error 23505 = unique constraint violated (duplicate email/username).
  if (err.code === '23505') {
    const field = err.constraint?.includes('email') ? 'email' : 'username';
    return res.status(409).json({ error: { message: `That ${field} is already taken`, details: { [field]: 'already taken' } } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Request body is not valid JSON' } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, details: err.details } });
  }
  console.error(err);
  res.status(500).json({ error: { message: 'Something went wrong' } }); // never leak internals
}
