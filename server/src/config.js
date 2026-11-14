// All configuration comes from environment variables (see .env.example).
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  isProduction,
  isTest: process.env.NODE_ENV === 'test',
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/inkwell',
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  jwtExpiresIn: '7d',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
};
