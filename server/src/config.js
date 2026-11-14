// All configuration comes from environment variables (see .env.example).
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

// True when running as a serverless function on Vercel.
const isServerless = Boolean(process.env.VERCEL);

export const config = {
  isProduction,
  isServerless,
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/inkwell',
  // A serverless host may run many copies of the app at once, and each copy
  // has its own pool. Keeping each pool tiny stops them from using up the
  // database's connection limit between them.
  dbPoolSize: isServerless ? 2 : 10,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: '7d',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
};
