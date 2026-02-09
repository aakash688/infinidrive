/**
 * Backup Routes
 * Manage auto-backup configurations
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

// All routes require authentication
app.use('*', authMiddleware);

/**
 * POST /api/backup/config
 * Save backup folder configuration
 */
app.post('/config', async (c) => {
  try {
    const user = c.get('user');
    const { device_id, folder_path, is_active, wifi_only, frequency, file_types } = await c.req.json();

    if (!device_id || !folder_path) {
      return c.json({ error: 'device_id and folder_path required' }, 400);
    }

    // Verify device belongs to user
    const device = await c.env.DB.prepare(
      'SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?'
    ).bind(device_id, user.user_id).first();

    if (!device) {
      return c.json({ error: 'Device not found' }, 404);
    }

    // Check if config exists
    const existing = await c.env.DB.prepare(
      'SELECT config_id FROM backup_configs WHERE user_id = ? AND device_id = ? AND folder_path = ?'
    ).bind(user.user_id, device_id, folder_path).first();

    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      // Update existing config
      await c.env.DB.prepare(`
        UPDATE backup_configs 
        SET is_active = ?, wifi_only = ?, frequency = ?, file_types = ?, updated_at = ?
        WHERE config_id = ?
      `).bind(
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        wifi_only !== undefined ? (wifi_only ? 1 : 0) : 1,
        frequency || 'daily',
        file_types || 'all',
        now,
        (existing as any).config_id
      ).run();
    } else {
      // Create new config
      const config_id = `config_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      await c.env.DB.prepare(`
        INSERT INTO backup_configs (
          config_id, user_id, device_id, folder_path, is_active,
          wifi_only, frequency, file_types, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        config_id,
        user.user_id,
        device_id,
        folder_path,
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        wifi_only !== undefined ? (wifi_only ? 1 : 0) : 1,
        frequency || 'daily',
        file_types || 'all',
        now,
        now
      ).run();
    }

    return c.json({ success: true, message: 'Backup config saved' });
  } catch (error) {
    console.error('Save backup config error:', error);
    return c.json({ error: 'Failed to save backup config' }, 500);
  }
});

/**
 * GET /api/backup/config/:device_id
 * Get backup config for device
 */
app.get('/config/:device_id', async (c) => {
  try {
    const user = c.get('user');
    const device_id = c.req.param('device_id');

    // Verify device belongs to user
    const device = await c.env.DB.prepare(
      'SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?'
    ).bind(device_id, user.user_id).first();

    if (!device) {
      return c.json({ error: 'Device not found' }, 404);
    }

    const configs = await c.env.DB.prepare(`
      SELECT 
        config_id, folder_path, is_active, wifi_only, frequency,
        file_types, last_backup_at, created_at, updated_at
      FROM backup_configs
      WHERE user_id = ? AND device_id = ? AND is_active = 1
      ORDER BY created_at DESC
    `).bind(user.user_id, device_id).all<{
      config_id: string;
      folder_path: string;
      is_active: number;
      wifi_only: number;
      frequency: string;
      file_types: string;
      last_backup_at: number | null;
      created_at: number;
      updated_at: number;
    }>();

    return c.json({
      configs: configs.results.map(config => ({
        config_id: config.config_id,
        folder_path: config.folder_path,
        is_active: config.is_active === 1,
        wifi_only: config.wifi_only === 1,
        frequency: config.frequency,
        file_types: config.file_types,
        last_backup_at: config.last_backup_at,
        created_at: config.created_at,
        updated_at: config.updated_at,
      })),
    });
  } catch (error) {
    console.error('Get backup config error:', error);
    return c.json({ error: 'Failed to get backup config' }, 500);
  }
});

/**
 * POST /api/backup/check
 * Check which files need backup (send hashes, get missing list)
 */
app.post('/check', async (c) => {
  try {
    const user = c.get('user');
    const { device_id, file_hashes } = await c.req.json();

    if (!device_id || !Array.isArray(file_hashes)) {
      return c.json({ error: 'device_id and file_hashes array required' }, 400);
    }

    // Verify device belongs to user
    const device = await c.env.DB.prepare(
      'SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?'
    ).bind(device_id, user.user_id).first();

    if (!device) {
      return c.json({ error: 'Device not found' }, 404);
    }

    // Find which hashes don't exist in user's storage
    const placeholders = file_hashes.map(() => '?').join(',');
    const existing = await c.env.DB.prepare(`
      SELECT file_hash FROM files
      WHERE user_id = ? AND file_hash IN (${placeholders}) AND is_deleted = 0
    `).bind(user.user_id, ...file_hashes).all<{ file_hash: string }>();

    const existingHashes = new Set(existing.results.map(f => f.file_hash));
    const missingHashes = file_hashes.filter((hash: string) => !existingHashes.has(hash));

    return c.json({
      total_checked: file_hashes.length,
      existing: existingHashes.size,
      missing: missingHashes.length,
      missing_hashes: missingHashes,
    });
  } catch (error) {
    console.error('Backup check error:', error);
    return c.json({ error: 'Failed to check backup status' }, 500);
  }
});

export default app;
