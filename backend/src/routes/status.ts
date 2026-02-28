/**
 * System Status & Monitoring Routes
 * Provides real-time status of uploads, bots, and system health
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

const app = new Hono();

// All routes require authentication
app.use('*', authMiddleware);

/**
 * GET /api/status/overview
 * Get complete system overview
 */
app.get('/overview', async (c) => {
  try {
    const user = c.get('user');

    // File statistics
    const filesStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_files,
        SUM(file_size) as total_size,
        COUNT(CASE WHEN created_at > unixepoch() - 86400 THEN 1 END) as files_today,
        SUM(CASE WHEN created_at > unixepoch() - 86400 THEN file_size ELSE 0 END) as size_today
      FROM files
      WHERE user_id = ? AND is_deleted = 0
    `).bind(user.user_id).first<{
      total_files: number;
      total_size: number | null;
      files_today: number;
      size_today: number | null;
    }>();

    // Active bots
    const activeBots = await c.env.DB.prepare(`
      SELECT 
        bot_id, bot_username, bot_name, health_status, 
        last_health_check, channel_id, is_active
      FROM bots
      WHERE user_id = ? AND is_active = 1
      ORDER BY last_health_check DESC
    `).bind(user.user_id).all<{
      bot_id: string;
      bot_username: string | null;
      bot_name: string | null;
      health_status: string;
      last_health_check: number | null;
      channel_id: string | null;
      is_active: number;
    }>();

    // Recent webhook logs (last 24 hours)
    const recentLogs = await c.env.DB.prepare(`
      SELECT 
        log_id, bot_id, file_id, file_name, file_size, status, 
        error_message, created_at
      FROM webhook_logs
      WHERE user_id = ? AND created_at > unixepoch() - 86400
      ORDER BY created_at DESC
      LIMIT 50
    `).bind(user.user_id).all<{
      log_id: string;
      bot_id: string;
      file_id: string | null;
      file_name: string | null;
      file_size: number | null;
      status: string;
      error_message: string | null;
      created_at: number;
    }>();

    // Active uploads (files created in last 10 minutes that might still be uploading)
    const activeUploads = await c.env.DB.prepare(`
      SELECT 
        f.file_id, f.file_name, f.file_size, f.chunk_count,
        COUNT(c.chunk_id) as uploaded_chunks,
        f.created_at
      FROM files f
      LEFT JOIN chunks c ON f.file_id = c.file_id
      WHERE f.user_id = ? 
        AND f.is_deleted = 0
        AND f.created_at > unixepoch() - 600
        AND f.source = 'webhook'
      GROUP BY f.file_id
      HAVING uploaded_chunks < f.chunk_count
      ORDER BY f.created_at DESC
    `).bind(user.user_id).all<{
      file_id: string;
      file_name: string;
      file_size: number;
      chunk_count: number;
      uploaded_chunks: number;
      created_at: number;
    }>();

    return c.json({
      files: {
        total: filesStats?.total_files || 0,
        total_size: filesStats?.total_size || 0,
        today: {
          count: filesStats?.files_today || 0,
          size: filesStats?.size_today || 0,
        },
      },
      bots: {
        total: activeBots.results.length,
        active: activeBots.results.filter(b => b.health_status === 'healthy').length,
        list: activeBots.results.map(bot => ({
          bot_id: bot.bot_id,
          username: bot.bot_username,
          name: bot.bot_name,
          health: bot.health_status,
          last_check: bot.last_health_check,
          has_channel: !!bot.channel_id,
        })),
      },
      uploads: {
        active: activeUploads.results.length,
        list: activeUploads.results.map(upload => ({
          file_id: upload.file_id,
          file_name: upload.file_name,
          file_size: upload.file_size,
          progress: Math.round((upload.uploaded_chunks / upload.chunk_count) * 100),
          chunks_uploaded: upload.uploaded_chunks,
          chunks_total: upload.chunk_count,
          started_at: upload.created_at,
        })),
      },
      logs: {
        recent: recentLogs.results.length,
        list: recentLogs.results.map(log => ({
          log_id: log.log_id,
          bot_id: log.bot_id,
          file_id: log.file_id,
          file_name: log.file_name,
          file_size: log.file_size,
          status: log.status,
          error: log.error_message,
          created_at: log.created_at,
        })),
      },
      timestamp: Math.floor(Date.now() / 1000),
    });
  } catch (error) {
    console.error('Status overview error:', error);
    return c.json({ error: 'Failed to get status overview' }, 500);
  }
});

/**
 * GET /api/status/active-uploads
 * Get currently active uploads with progress
 */
app.get('/active-uploads', async (c) => {
  try {
    const user = c.get('user');

    const activeUploads = await c.env.DB.prepare(`
      SELECT 
        f.file_id, f.file_name, f.file_size, f.chunk_count,
        COUNT(c.chunk_id) as uploaded_chunks,
        f.created_at, f.source
      FROM files f
      LEFT JOIN chunks c ON f.file_id = c.file_id
      WHERE f.user_id = ? 
        AND f.is_deleted = 0
        AND f.created_at > unixepoch() - 1800
      GROUP BY f.file_id
      HAVING uploaded_chunks < f.chunk_count
      ORDER BY f.created_at DESC
    `).bind(user.user_id).all<{
      file_id: string;
      file_name: string;
      file_size: number;
      chunk_count: number;
      uploaded_chunks: number;
      created_at: number;
      source: string | null;
    }>();

    return c.json({
      active: activeUploads.results.length,
      uploads: activeUploads.results.map(upload => {
        const progress = Math.round((upload.uploaded_chunks / upload.chunk_count) * 100);
        const elapsed = Math.floor(Date.now() / 1000) - upload.created_at;
        const uploadedSize = (upload.uploaded_chunks / upload.chunk_count) * upload.file_size;
        const speed = elapsed > 0 ? uploadedSize / elapsed : 0; // bytes per second

        return {
          file_id: upload.file_id,
          file_name: upload.file_name,
          file_size: upload.file_size,
          progress,
          chunks_uploaded: upload.uploaded_chunks,
          chunks_total: upload.chunk_count,
          uploaded_size: uploadedSize,
          speed: speed, // bytes per second
          speed_formatted: formatSpeed(speed),
          elapsed_seconds: elapsed,
          estimated_remaining: upload.chunk_count > upload.uploaded_chunks && speed > 0
            ? Math.round((upload.file_size - uploadedSize) / speed)
            : null,
          started_at: upload.created_at,
          source: upload.source || 'manual',
        };
      }),
    });
  } catch (error) {
    console.error('Active uploads error:', error);
    return c.json({ error: 'Failed to get active uploads' }, 500);
  }
});

/**
 * GET /api/status/bots
 * Get detailed bot status
 */
app.get('/bots', async (c) => {
  try {
    const user = c.get('user');

    const bots = await c.env.DB.prepare(`
      SELECT 
        bot_id, bot_username, bot_name, health_status,
        last_health_check, channel_id, is_active,
        (SELECT COUNT(*) FROM chunks WHERE bot_id = bots.bot_id) as chunks_count,
        (SELECT COUNT(*) FROM files f 
         JOIN chunks c ON f.file_id = c.file_id 
         WHERE c.bot_id = bots.bot_id AND f.is_deleted = 0) as files_count
      FROM bots
      WHERE user_id = ?
      ORDER BY is_active DESC, last_health_check DESC
    `).bind(user.user_id).all<{
      bot_id: string;
      bot_username: string | null;
      bot_name: string | null;
      health_status: string;
      last_health_check: number | null;
      channel_id: string | null;
      is_active: number;
      chunks_count: number;
      files_count: number;
    }>();

    return c.json({
      total: bots.results.length,
      active: bots.results.filter(b => b.is_active === 1).length,
      healthy: bots.results.filter(b => b.health_status === 'healthy').length,
      bots: bots.results.map(bot => ({
        bot_id: bot.bot_id,
        username: bot.bot_username,
        name: bot.bot_name,
        health: bot.health_status,
        is_active: bot.is_active === 1,
        has_channel: !!bot.channel_id,
        last_check: bot.last_health_check,
        stats: {
          chunks: bot.chunks_count,
          files: bot.files_count,
        },
      })),
    });
  } catch (error) {
    console.error('Bots status error:', error);
    return c.json({ error: 'Failed to get bot status' }, 500);
  }
});

/**
 * GET /api/status/logs
 * Get webhook logs
 */
app.get('/logs', async (c) => {
  try {
    const user = c.get('user');
    const limit = parseInt(c.req.query('limit') || '50');
    const status = c.req.query('status'); // 'captured', 'failed', 'skipped'

    let query = `
      SELECT 
        log_id, bot_id, file_id, telegram_file_id,
        sender_id, sender_username, sender_name,
        chat_id, chat_title,
        file_name, file_size, mime_type, caption,
        status, error_message, created_at
      FROM webhook_logs
      WHERE user_id = ?
    `;

    const params: any[] = [user.user_id];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const logs = await c.env.DB.prepare(query).bind(...params).all<{
      log_id: string;
      bot_id: string;
      file_id: string | null;
      telegram_file_id: string | null;
      sender_id: string | null;
      sender_username: string | null;
      sender_name: string | null;
      chat_id: string | null;
      chat_title: string | null;
      file_name: string | null;
      file_size: number | null;
      mime_type: string | null;
      caption: string | null;
      status: string;
      error_message: string | null;
      created_at: number;
    }>();

    return c.json({
      total: logs.results.length,
      logs: logs.results.map(log => ({
        log_id: log.log_id,
        bot_id: log.bot_id,
        file_id: log.file_id,
        telegram_file_id: log.telegram_file_id,
        sender: {
          id: log.sender_id,
          username: log.sender_username,
          name: log.sender_name,
        },
        chat: {
          id: log.chat_id,
          title: log.chat_title,
        },
        file: {
          name: log.file_name,
          size: log.file_size,
          mime_type: log.mime_type,
          caption: log.caption,
        },
        status: log.status,
        error: log.error_message,
        created_at: log.created_at,
      })),
    });
  } catch (error) {
    console.error('Logs error:', error);
    return c.json({ error: 'Failed to get logs' }, 500);
  }
});

/**
 * GET /api/status/files/links
 * Get share links for all public files
 */
app.get('/files/links', async (c) => {
  try {
    const user = c.get('user');

    const files = await c.env.DB.prepare(`
      SELECT 
        f.file_id, f.file_name, f.file_size, f.is_public,
        s.share_id, s.expires_at, s.is_active
      FROM files f
      LEFT JOIN shares s ON f.file_id = s.file_id AND s.is_active = 1
      WHERE f.user_id = ? AND f.is_deleted = 0
      ORDER BY f.created_at DESC
    `).bind(user.user_id).all<{
      file_id: string;
      file_name: string;
      file_size: number;
      is_public: number;
      share_id: string | null;
      expires_at: number | null;
      is_active: number | null;
    }>();

    const baseUrl = c.req.header('Origin') || 'https://infinidrive-web.pages.dev';

    return c.json({
      total: files.results.length,
      files: files.results.map(file => ({
        file_id: file.file_id,
        file_name: file.file_name,
        file_size: file.file_size,
        is_public: file.is_public === 1,
        share_link: file.share_id
          ? `${baseUrl}/share/${file.share_id}`
          : null,
        share_id: file.share_id,
        expires_at: file.expires_at,
        download_link: `${baseUrl}/api/files/${file.file_id}/download`,
        stream_link: `${baseUrl}/api/files/${file.file_id}/stream`,
      })),
    });
  } catch (error) {
    console.error('Files links error:', error);
    return c.json({ error: 'Failed to get file links' }, 500);
  }
});

// Helper function to format speed
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) {
    return `${bytesPerSecond.toFixed(0)} B/s`;
  } else if (bytesPerSecond < 1024 * 1024) {
    return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
  } else {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
  }
}

export default app;
