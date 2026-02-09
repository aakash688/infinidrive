/**
 * API Key Management Routes
 * Create, list, revoke API keys (JWT authenticated)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', authMiddleware);

/**
 * Generate a secure API key
 */
function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomBytes = new Uint8Array(40);
  crypto.getRandomValues(randomBytes);
  let key = 'infini_';
  for (let i = 0; i < 40; i++) {
    key += chars[randomBytes[i] % chars.length];
  }
  return key;
}

/**
 * POST /api/keys/create
 */
app.post('/create', async (c) => {
  try {
    const user = c.get('user');
    const { project_id, key_name, permissions, expires_in_days } = await c.req.json();

    if (!project_id || !key_name?.trim()) {
      return c.json({ error: 'project_id and key_name are required' }, 400);
    }

    // Verify project belongs to user
    const project = await c.env.DB.prepare(
      'SELECT project_id, project_name FROM projects WHERE project_id = ? AND user_id = ? AND is_active = 1'
    ).bind(project_id, user.user_id).first();

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // Check key limit per project (max 10)
    const keyCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM api_keys WHERE project_id = ? AND is_active = 1'
    ).bind(project_id).first<{ count: number }>();

    if (keyCount && keyCount.count >= 10) {
      return c.json({ error: 'Maximum 10 API keys per project' }, 400);
    }

    const key_id = `key_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const api_key = generateApiKey();
    const key_prefix = api_key.substring(0, 15) + '...';
    const now = Math.floor(Date.now() / 1000);
    const expires_at = expires_in_days ? now + (expires_in_days * 86400) : null;

    await c.env.DB.prepare(`
      INSERT INTO api_keys (key_id, user_id, project_id, key_name, api_key, key_prefix, permissions, expires_at, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).bind(
      key_id,
      user.user_id,
      project_id,
      key_name.trim(),
      api_key,
      key_prefix,
      permissions || 'read,write',
      expires_at,
      now
    ).run();

    return c.json({
      key_id,
      key_name: key_name.trim(),
      api_key, // ONLY returned once at creation!
      key_prefix,
      project_id,
      permissions: permissions || 'read,write',
      expires_at,
      created_at: now,
      message: '⚠️ Save this API key now. It will NOT be shown again.',
    });
  } catch (error) {
    console.error('Create API key error:', error);
    return c.json({ error: 'Failed to create API key', message: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

/**
 * GET /api/keys/list
 */
app.get('/list', async (c) => {
  try {
    const user = c.get('user');
    const project_id = c.req.query('project_id');

    let query = `
      SELECT ak.key_id, ak.key_name, ak.key_prefix, ak.project_id, ak.permissions,
        ak.last_used_at, ak.expires_at, ak.is_active, ak.created_at,
        p.project_name
      FROM api_keys ak
      JOIN projects p ON ak.project_id = p.project_id
      WHERE ak.user_id = ? AND ak.is_active = 1
    `;
    const params: any[] = [user.user_id];

    if (project_id) {
      query += ' AND ak.project_id = ?';
      params.push(project_id);
    }

    query += ' ORDER BY ak.created_at DESC';

    const keys = await c.env.DB.prepare(query).bind(...params).all();

    // Never return the full api_key, only the prefix
    return c.json({ keys: keys.results });
  } catch (error) {
    console.error('List API keys error:', error);
    return c.json({ error: 'Failed to list API keys' }, 500);
  }
});

/**
 * DELETE /api/keys/:key_id
 */
app.delete('/:key_id', async (c) => {
  try {
    const user = c.get('user');
    const key_id = c.req.param('key_id');

    const key = await c.env.DB.prepare(
      'SELECT key_id FROM api_keys WHERE key_id = ? AND user_id = ? AND is_active = 1'
    ).bind(key_id, user.user_id).first();

    if (!key) {
      return c.json({ error: 'API key not found' }, 404);
    }

    await c.env.DB.prepare(
      'UPDATE api_keys SET is_active = 0 WHERE key_id = ?'
    ).bind(key_id).run();

    return c.json({ success: true, message: 'API key revoked' });
  } catch (error) {
    console.error('Revoke API key error:', error);
    return c.json({ error: 'Failed to revoke API key' }, 500);
  }
});

export default app;
