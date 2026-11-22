// All configuration comes from environment variables (see .env.example).
const isProduction = process.env.NODE_ENV === 'production';

// True when running as a serverless function on Vercel.
const isServerless = Boolean(process.env.VERCEL);

export const config = {
  isProduction,
  isServerless,
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT) || 4000,
  // Hosted Postgres add-ons name this variable differently; accept both.
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgres://postgres:postgres@localhost:5432/inkwell',
  // A serverless host may run many copies of the app at once, and each copy
  // has its own pool. Keeping each pool tiny stops them from using up the
  // database's connection limit between them.
  dbPoolSize: isServerless ? 2 : 10,
  // In production there is deliberately no built-in default: if JWT_SECRET is
  // not set this stays null until ensureJwtSecret() (src/secret.js) loads the
  // app's own generated secret from the database. A null secret makes signing
  // fail loudly, so a guessable key can never be used by accident.
  jwtSecret: process.env.JWT_SECRET || (isProduction ? null : 'dev-only-secret-change-me'),
  jwtExpiresIn: '7d',
  // How long the trending ranking and the tag list are cached, in ms. Off in
  // tests, which change the data directly and expect to see it at once.
  cacheMs: process.env.CACHE_MS !== undefined ? Number(process.env.CACHE_MS) : (process.env.NODE_ENV === 'test' ? 0 : 30_000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
};
