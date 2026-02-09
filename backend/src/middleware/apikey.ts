/**
 * API Key Authentication Middleware
 * Validates API keys and resolves user + project context
 */

import { Context, Next } from 'hono';

export interface ApiKeyContext {
  key_id: string;
  user_id: string;
  project_id: string;
  key_name: string;
  permissions: string;
}

export interface ProjectContext {
  project_id: string;
  project_name: string;
  folder_id: string | null;
}

/**
 * Middleware that authenticates requests using API keys
 * Sets 'user', 'apiKey', and 'project' on the context
 */
export async function apiKeyMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');
  const queryKey = c.req.query('api_key');
  
  const rawKey = queryKey || (authHeader?.startsWith('Bearer infini_') ? authHeader.replace('Bearer ', '') : null);

  if (!rawKey || !rawKey.startsWith('infini_')) {
    return c.json({
      error: 'API key required',
      message: 'Provide API key via Authorization: Bearer infini_... header or ?api_key= query parameter',
    }, 401);
  }

  try {
    // Look up key and join project
    const record = await c.env.DB.prepare(`
      SELECT 
        ak.key_id, ak.user_id, ak.project_id, ak.key_name, ak.permissions,
        ak.expires_at, ak.is_active,
        p.project_name, p.folder_id, p.is_active as project_active
      FROM api_keys ak
      JOIN projects p ON ak.project_id = p.project_id
      WHERE ak.api_key = ?
    `).bind(rawKey).first<{
      key_id: string;
      user_id: string;
      project_id: string;
      key_name: string;
      permissions: string;
      expires_at: number | null;
      is_active: number;
      project_name: string;
      folder_id: string | null;
      project_active: number;
    }>();

    if (!record) {
      return c.json({ error: 'Invalid API key' }, 401);
    }

    if (!record.is_active) {
      return c.json({ error: 'API key has been revoked' }, 401);
    }

    if (!record.project_active) {
      return c.json({ error: 'Project is inactive' }, 403);
    }

    if (record.expires_at && record.expires_at < Math.floor(Date.now() / 1000)) {
      return c.json({ error: 'API key has expired' }, 401);
    }

    // Update last_used_at (fire and forget)
    c.env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE key_id = ?')
      .bind(Math.floor(Date.now() / 1000), record.key_id).run();

    // Set context
    c.set('user', { user_id: record.user_id, display_name: 'API', telegram_id: 0 });
    c.set('apiKey', {
      key_id: record.key_id,
      user_id: record.user_id,
      project_id: record.project_id,
      key_name: record.key_name,
      permissions: record.permissions,
    } as ApiKeyContext);
    c.set('project', {
      project_id: record.project_id,
      project_name: record.project_name,
      folder_id: record.folder_id,
    } as ProjectContext);

    await next();
  } catch (error) {
    console.error('API key auth error:', error);
    return c.json({ error: 'Authentication failed' }, 500);
  }
}

/**
 * Check if API key has a specific permission
 */
export function hasPermission(permissions: string, required: string): boolean {
  const perms = permissions.split(',').map(p => p.trim());
  return perms.includes(required) || perms.includes('admin');
}
