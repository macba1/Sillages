import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';

import authRoutes from './routes/auth.js';
import shopifyRoutes from './routes/shopify.js';
import briefsRoutes from './routes/briefs.js';
import billingRoutes from './routes/billing.js';
import webhooksRoutes from './routes/webhooks.js';
import alertsRoutes from './routes/alerts.js';
import accountsRoutes from './routes/accounts.js';
import adminRoutes from './routes/admin.js';

import { startScheduler } from './services/scheduler.js';

const app = express();
app.set('trust proxy', 1);

// ── Security & middleware ──────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Raw body required for Stripe and Shopify webhook signature verification
// Must be registered BEFORE express.json()
app.use('/api/webhooks', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── CORS ──────────────────────────────────────────────────────
app.use(
  cors({
    origin: [env.FRONTEND_URL, 'https://sillages.app', 'https://www.sillages.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// ── Rate limiting ─────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api', limiter);

// ── Health check ──────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/briefs', briefsRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/webhooks', webhooksRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/accounts', accountsRoutes);
app.use('/api/admin', adminRoutes);

// ── 404 ───────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Error handler (must be last) ──────────────────────────────
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────
const PORT = env.PORT;

app.listen(PORT, () => {
  console.log(`[server] Running on port ${PORT} in ${env.NODE_ENV} mode`);
  startScheduler();
});

export default app;
