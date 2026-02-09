/**
 * Statistics Routes
 * User storage statistics
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
 * GET /api/stats
 * Get user storage statistics
 */
app.get('/', async (c) => {
  try {
    const user = c.get('user');

    // Total files count
    const filesCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM files
      WHERE user_id = ? AND is_deleted = 0
    `).bind(user.user_id).first<{ count: number }>();

    // Total storage size
    const storageSize = await c.env.DB.prepare(`
      SELECT SUM(file_size) as total_size
      FROM files
      WHERE user_id = ? AND is_deleted = 0
    `).bind(user.user_id).first<{ total_size: number | null }>();

    // Device count
    const deviceCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM devices
      WHERE user_id = ?
    `).bind(user.user_id).first<{ count: number }>();

    // Bot count
    const botCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM bots
      WHERE user_id = ? AND is_active = 1
    `).bind(user.user_id).first<{ count: number }>();

    // Files by type
    const filesByType = await c.env.DB.prepare(`
      SELECT 
        CASE 
          WHEN mime_type LIKE 'video/%' THEN 'video'
          WHEN mime_type LIKE 'image/%' THEN 'image'
          WHEN mime_type LIKE 'audio/%' THEN 'audio'
          WHEN mime_type LIKE 'application/%' OR mime_type LIKE 'text/%' THEN 'document'
          ELSE 'other'
        END as file_type,
        COUNT(*) as count,
        SUM(file_size) as total_size
      FROM files
      WHERE user_id = ? AND is_deleted = 0
      GROUP BY file_type
    `).bind(user.user_id).all<{
      file_type: string;
      count: number;
      total_size: number;
    }>();

    // Recent files (last 10)
    const recentFiles = await c.env.DB.prepare(`
      SELECT file_id, file_name, file_size, mime_type, created_at
      FROM files
      WHERE user_id = ? AND is_deleted = 0
      ORDER BY created_at DESC
      LIMIT 10
    `).bind(user.user_id).all<{
      file_id: string;
      file_name: string;
      file_size: number;
      mime_type: string | null;
      created_at: number;
    }>();

    return c.json({
      total_files: filesCount?.count || 0,
      total_size: storageSize?.total_size || 0,
      total_devices: deviceCount?.count || 0,
      total_bots: botCount?.count || 0,
      files_by_type: filesByType.results.map(f => ({
        type: f.file_type,
        count: f.count,
        size: f.total_size || 0,
      })),
      recent_files: recentFiles.results.map(f => ({
        file_id: f.file_id,
        file_name: f.file_name,
        file_size: f.file_size,
        mime_type: f.mime_type,
        created_at: f.created_at,
      })),
    });
  } catch (error) {
    console.error('Stats error:', error);
    return c.json({ error: 'Failed to get statistics' }, 500);
  }
});

export default app;
