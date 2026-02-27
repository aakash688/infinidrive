/**
 * Cleanup Routes
 * Delete orphaned chunks from Telegram channels for deleted files
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
 * GET /api/cleanup/orphaned-chunks
 * Get list of orphaned chunks (chunks for deleted files)
 */
app.get('/orphaned-chunks', async (c) => {
  try {
    const user = c.get('user');
    const limit = parseInt(c.req.query('limit') || '100');

    // Find chunks that belong to deleted files
    const orphanedChunks = await c.env.DB.prepare(`
      SELECT 
        c.chunk_id, c.file_id, c.chunk_index, c.telegram_message_id,
        c.channel_id, c.bot_id, c.created_at,
        b.bot_token_enc, b.bot_username
      FROM chunks c
      LEFT JOIN files f ON c.file_id = f.file_id
      LEFT JOIN bots b ON c.bot_id = b.bot_id
      WHERE f.file_id IS NULL OR f.is_deleted = 1
      AND b.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `).bind(user.user_id, limit).all<{
      chunk_id: string;
      file_id: string;
      chunk_index: number;
      telegram_message_id: number;
      channel_id: string;
      bot_id: string;
      created_at: number;
      bot_token_enc: string;
      bot_username: string;
    }>();

    return c.json({
      orphaned_chunks: orphanedChunks.results,
      total: orphanedChunks.results.length,
    });
  } catch (error) {
    console.error('Get orphaned chunks error:', error);
    return c.json({ error: 'Failed to get orphaned chunks' }, 500);
  }
});

/**
 * POST /api/cleanup/delete-orphaned-chunks
 * Delete orphaned chunks from Telegram channels
 */
app.post('/delete-orphaned-chunks', async (c) => {
  try {
    const user = c.get('user');
    const { dry_run = false, limit = 100 } = await c.req.json();

    // Get orphaned chunks
    const orphanedChunks = await c.env.DB.prepare(`
      SELECT 
        c.chunk_id, c.file_id, c.chunk_index, c.telegram_message_id,
        c.channel_id, c.bot_id, c.created_at,
        b.bot_token_enc, b.bot_username
      FROM chunks c
      LEFT JOIN files f ON c.file_id = f.file_id
      LEFT JOIN bots b ON c.bot_id = b.bot_id
      WHERE (f.file_id IS NULL OR f.is_deleted = 1)
      AND b.user_id = ?
      ORDER BY c.created_at DESC
      LIMIT ?
    `).bind(user.user_id, limit).all<{
      chunk_id: string;
      file_id: string;
      chunk_index: number;
      telegram_message_id: number;
      channel_id: string;
      bot_id: string;
      created_at: number;
      bot_token_enc: string;
      bot_username: string;
    }>();

    const results = {
      total_found: orphanedChunks.results.length,
      deleted: 0,
      failed: 0,
      errors: [] as string[],
    };

    if (dry_run) {
      return c.json({
        ...results,
        message: 'Dry run - no chunks were deleted',
        chunks: orphanedChunks.results.map(chunk => ({
          chunk_id: chunk.chunk_id,
          file_id: chunk.file_id,
          bot_username: chunk.bot_username,
          channel_id: chunk.channel_id,
          message_id: chunk.telegram_message_id,
        })),
      });
    }

    // Delete chunks from Telegram and database
    for (const chunk of orphanedChunks.results) {
      try {
        // Delete message from Telegram channel
        const deleteResponse = await fetch(`https://api.telegram.org/bot${chunk.bot_token_enc}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chunk.channel_id,
            message_id: chunk.telegram_message_id,
          }),
        });

        const deleteResult: any = await deleteResponse.json();

        if (deleteResult.ok) {
          // Delete chunk from database
          await c.env.DB.prepare(`DELETE FROM chunks WHERE chunk_id = ?`).bind(chunk.chunk_id).run();
          results.deleted++;
          console.log(`[cleanup] Deleted chunk ${chunk.chunk_id} from Telegram`);
        } else {
          // If message already deleted or not found, still remove from DB
          if (deleteResult.error_code === 400 || deleteResult.description?.includes('message to delete not found')) {
            await c.env.DB.prepare(`DELETE FROM chunks WHERE chunk_id = ?`).bind(chunk.chunk_id).run();
            results.deleted++;
            console.log(`[cleanup] Chunk ${chunk.chunk_id} already deleted from Telegram, removed from DB`);
          } else {
            results.failed++;
            results.errors.push(`Chunk ${chunk.chunk_id}: ${deleteResult.description || 'Unknown error'}`);
            console.error(`[cleanup] Failed to delete chunk ${chunk.chunk_id}:`, deleteResult.description);
          }
        }
      } catch (error) {
        results.failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Chunk ${chunk.chunk_id}: ${errorMsg}`);
        console.error(`[cleanup] Error deleting chunk ${chunk.chunk_id}:`, error);
      }
    }

    return c.json({
      ...results,
      message: `Deleted ${results.deleted} orphaned chunks, ${results.failed} failed`,
    });
  } catch (error) {
    console.error('Delete orphaned chunks error:', error);
    return c.json({ error: 'Failed to delete orphaned chunks' }, 500);
  }
});

/**
 * POST /api/cleanup/delete-file-chunks
 * Delete all chunks for a specific deleted file
 */
app.post('/delete-file-chunks/:file_id', async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');

    // Verify file belongs to user and is deleted
    const file = await c.env.DB.prepare(`
      SELECT file_id, is_deleted FROM files WHERE file_id = ? AND user_id = ?
    `).bind(file_id, user.user_id).first<{ file_id: string; is_deleted: number }>();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    if (file.is_deleted === 0) {
      return c.json({ error: 'File is not deleted. Delete the file first.' }, 400);
    }

    // Get all chunks for this file
    const chunks = await c.env.DB.prepare(`
      SELECT 
        c.chunk_id, c.telegram_message_id, c.channel_id, c.bot_id,
        b.bot_token_enc
      FROM chunks c
      JOIN bots b ON c.bot_id = b.bot_id
      WHERE c.file_id = ? AND b.user_id = ?
    `).bind(file_id, user.user_id).all<{
      chunk_id: string;
      telegram_message_id: number;
      channel_id: string;
      bot_id: string;
      bot_token_enc: string;
    }>();

    const results = {
      total: chunks.results.length,
      deleted: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Delete each chunk
    for (const chunk of chunks.results) {
      try {
        const deleteResponse = await fetch(`https://api.telegram.org/bot${chunk.bot_token_enc}/deleteMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chunk.channel_id,
            message_id: chunk.telegram_message_id,
          }),
        });

        const deleteResult: any = await deleteResponse.json();

        if (deleteResult.ok || deleteResult.error_code === 400) {
          await c.env.DB.prepare(`DELETE FROM chunks WHERE chunk_id = ?`).bind(chunk.chunk_id).run();
          results.deleted++;
        } else {
          results.failed++;
          results.errors.push(`Chunk ${chunk.chunk_id}: ${deleteResult.description || 'Unknown error'}`);
        }
      } catch (error) {
        results.failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        results.errors.push(`Chunk ${chunk.chunk_id}: ${errorMsg}`);
      }
    }

    return c.json({
      ...results,
      message: `Deleted ${results.deleted} chunks for file ${file_id}`,
    });
  } catch (error) {
    console.error('Delete file chunks error:', error);
    return c.json({ error: 'Failed to delete file chunks' }, 500);
  }
});

/**
 * GET /api/cleanup/stats
 * Get cleanup statistics
 */
app.get('/stats', async (c) => {
  try {
    const user = c.get('user');

    // Count orphaned chunks
    const orphanedCount = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM chunks c
      LEFT JOIN files f ON c.file_id = f.file_id
      LEFT JOIN bots b ON c.bot_id = b.bot_id
      WHERE (f.file_id IS NULL OR f.is_deleted = 1)
      AND b.user_id = ?
    `).bind(user.user_id).first<{ count: number }>();

    // Count total chunks
    const totalChunks = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM chunks c
      JOIN bots b ON c.bot_id = b.bot_id
      WHERE b.user_id = ?
    `).bind(user.user_id).first<{ count: number }>();

    // Count deleted files
    const deletedFiles = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM files
      WHERE user_id = ? AND is_deleted = 1
    `).bind(user.user_id).first<{ count: number }>();

    return c.json({
      orphaned_chunks: orphanedCount?.count || 0,
      total_chunks: totalChunks?.count || 0,
      deleted_files: deletedFiles?.count || 0,
      orphaned_percentage: totalChunks?.count
        ? ((orphanedCount?.count || 0) / totalChunks.count * 100).toFixed(1)
        : '0',
    });
  } catch (error) {
    console.error('Get cleanup stats error:', error);
    return c.json({ error: 'Failed to get cleanup stats' }, 500);
  }
});

export default app;
