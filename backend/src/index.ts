import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import authRoutes from './routes/auth';
import botRoutes from './routes/bots';
import deviceRoutes from './routes/devices';
import fileRoutes from './routes/files';
import folderRoutes from './routes/folders';
import shareRoutes from './routes/share';
import communityRoutes from './routes/community';
import backupRoutes from './routes/backup';
import statsRoutes from './routes/stats';
import webhookRoutes from './routes/webhook';
import projectRoutes from './routes/projects';
import apiKeyRoutes from './routes/apikeys';
import v1Routes from './routes/v1';

type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  TELEGRAM_API_URL: string;
  TELEGRAM_BOT_TOKEN?: string; // Optional - only needed for secure Telegram Login verification
};

const app = new Hono<{ Bindings: Env }>();

// Middleware
app.use('*', logger());
app.use('*', cors({
  origin: '*', // In production, restrict to your domains
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length', 'Content-Range'],
  credentials: true,
}));

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.route('/api/auth', authRoutes);
app.route('/api/bots', botRoutes);
app.route('/api/devices', deviceRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/folders', folderRoutes);
app.route('/api/share', shareRoutes);
app.route('/api/community', communityRoutes);
app.route('/api/backup', backupRoutes);
app.route('/api/stats', statsRoutes);
app.route('/api/webhook', webhookRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/keys', apiKeyRoutes);
app.route('/api/v1', v1Routes);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

export default app;
