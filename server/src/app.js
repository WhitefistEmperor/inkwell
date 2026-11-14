// Builds the Express app. Kept separate from server.js so tests can import
// the app without opening a network port.
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware.js';
import { popularTags } from './articles.service.js';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profiles.js';
import articleRoutes from './routes/articles.js';
import notificationRoutes from './routes/notifications.js';

export const app = express();

app.use(helmet());                                // security headers
app.use(cors({ origin: config.clientOrigin }));   // only our frontend may call the API from a browser
app.use(express.json({ limit: '200kb' }));        // parse JSON bodies, reject huge ones

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/articles', articleRoutes);
app.use('/api/notifications', notificationRoutes);
app.get('/api/tags', async (req, res) => res.json({ tags: await popularTags() }));

// Order matters: these two must come after every route.
app.use(notFound);
app.use(errorHandler);
