import jwt from 'jsonwebtoken';
import { config } from './config.js';

// An error that carries an HTTP status and the RealWorld error body:
//   { "errors": { "<field>": ["<message>", ...] } }
// Routes throw it; errorHandler (bottom of this file) sends it.
export class HttpError extends Error {
  constructor(status, errors) {
    super(JSON.stringify(errors));
    this.status = status;
    this.errors = errors;
  }
}

export const notFoundError = (what) => new HttpError(404, { [what]: ['not found'] });
export const forbiddenError = (what) => new HttpError(403, { [what]: ['forbidden'] });

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

// The RealWorld spec sends "Authorization: Token <jwt>". The more common
// "Bearer <jwt>" is accepted too.
function tokenFromRequest(req) {
  const [scheme, token] = (req.get('authorization') || '').split(' ');
  return scheme === 'Token' || scheme === 'Bearer' ? token : null;
}

// Authentication: who are you? Protected routes use requireAuth.
export function requireAuth(req, res, next) {
  const token = tokenFromRequest(req);
  if (!token) return next(new HttpError(401, { token: ['is missing'] }));
  req.userId = verifyToken(token);
  if (!req.userId) return next(new HttpError(401, { token: ['is invalid'] }));
  next();
}

// Public routes that show extra information when signed in
// (e.g. whether *you* favorited an article) use optionalAuth.
export function optionalAuth(req, res, next) {
  req.userId = verifyToken(tokenFromRequest(req));
  next();
}

// Validates req.body / req.query against a zod schema before the route runs.
// The cleaned result is placed on req.valid, so routes never read raw input.
export const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    const errors = {};
    for (const issue of result.error.issues) {
      // Path is e.g. ["user", "email"]; the spec wants the error keyed by "email".
      const field = issue.path.findLast((part) => typeof part === 'string') ?? source;
      (errors[field] ??= []).push(issue.message);
    }
    return next(new HttpError(422, errors));
  }
  req.valid = { ...req.valid, [source]: result.data };
  next();
};

export function notFound(req, res, next) {
  next(notFoundError('route'));
}

// One place decides what every error response looks like.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  // PostgreSQL error 23505 = unique constraint violated (duplicate email/username).
  if (err.code === '23505') {
    const field = err.constraint?.includes('email') ? 'email' : 'username';
    return res.status(409).json({ errors: { [field]: ['has already been taken'] } });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ errors: { body: ['is not valid JSON'] } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ errors: err.errors });
  }
  console.error(err);
  res.status(500).json({ errors: { server: ['something went wrong'] } }); // never leak internals
}
