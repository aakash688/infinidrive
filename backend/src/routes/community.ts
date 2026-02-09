/**
 * Community Routes
 * List public files, fork files, view tracking
 */

import { Hono } from 'hono';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { sendDocument, downloadFile } from '../services/telegram';

type Env = {
  DB: D1Database;
};

const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/community/files
 * List public files (search, filter, sort, paginate)
 */
app.get('/files', optionalAuthMiddleware, async (c) => {
  try {
    const query = c.req.query('q') || '';
    const category = c.req.query('category'); // video | image | document | audio | other
    const sort = c.req.query('sort') || 'newest'; // newest | most_forked | most_viewed | size
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = parseInt(c.req.query('offset') || '0');

    let sql = `
      SELECT 
        file_id, file_name, file_size, mime_type, public_title, public_category,
        view_count, fork_count, created_at,
        (SELECT display_name FROM users WHERE users.user_id = files.user_id) as owner_name
      FROM files
      WHERE is_public = 1 AND is_deleted = 0
    `;
    const params: any[] = [];

    // Search
    if (query) {
      sql += ' AND (file_name LIKE ? OR public_title LIKE ? OR public_tags LIKE ?)';
      const searchTerm = `%${query}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    // Category filter
    if (category) {
      sql += ' AND public_category = ?';
      params.push(category);
    }

    // Sort
    switch (sort) {
      case 'most_forked':
        sql += ' ORDER BY fork_count DESC';
        break;
      case 'most_viewed':
        sql += ' ORDER BY view_count DESC';
        break;
      case 'size':
        sql += ' ORDER BY file_size DESC';
        break;
      case 'newest':
      default:
        sql += ' ORDER BY created_at DESC';
        break;
    }

    sql += ' LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const files = await c.env.DB.prepare(sql).bind(...params).all<{
      file_id: string;
      file_name: string;
      file_size: number;
      mime_type: string | null;
      public_title: string | null;
      public_category: string | null;
      view_count: number;
      fork_count: number;
      created_at: number;
      owner_name: string | null;
    }>();

    return c.json({
      files: files.results.map(f => ({
        file_id: f.file_id,
        file_name: f.file_name,
        public_title: f.public_title || f.file_name,
        file_size: f.file_size,
        mime_type: f.mime_type,
        public_category: f.public_category,
        view_count: f.view_count,
        fork_count: f.fork_count,
        created_at: f.created_at,
        owner_name: f.owner_name,
      })),
      total: files.results.length,
    });
  } catch (error) {
    console.error('List community files error:', error);
    return c.json({ error: 'Failed to list community files' }, 500);
  }
});

/**
 * POST /api/community/:file_id/fork
 * Fork a public file to user's own storage
 */
app.post('/:file_id/fork', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');

    // Get original file (must be public)
    const originalFile = await c.env.DB.prepare(`
      SELECT 
        file_id, file_name, file_path, file_size, mime_type, file_hash,
        chunk_count, user_id as original_user_id
      FROM files
      WHERE file_id = ? AND is_public = 1 AND is_deleted = 0
    `).bind(file_id).first<{
      file_id: string;
      file_name: string;
      file_path: string;
      file_size: number;
      mime_type: string | null;
      file_hash: string;
      chunk_count: number;
      original_user_id: string;
    }>();

    if (!originalFile) {
      return c.json({ error: 'File not found or not public' }, 404);
    }

    if (originalFile.original_user_id === user.user_id) {
      return c.json({ error: 'Cannot fork your own file' }, 400);
    }

    // Check if already forked
    const existing = await c.env.DB.prepare(
      'SELECT file_id FROM files WHERE user_id = ? AND file_hash = ? AND is_deleted = 0'
    ).bind(user.user_id, originalFile.file_hash).first();

    if (existing) {
      return c.json({ 
        error: 'File already forked',
        file_id: existing.file_id,
        duplicate: true
      }, 409);
    }

    // Get original chunks
    const originalChunks = await c.env.DB.prepare(`
      SELECT 
        chunk_index, chunk_size, chunk_hash, telegram_file_id,
        bot_id, bot_token_enc, channel_id
      FROM chunks
      JOIN bots ON chunks.bot_id = bots.bot_id
      WHERE chunks.file_id = ?
      ORDER BY chunk_index ASC
    `).bind(file_id).all<{
      chunk_index: number;
      chunk_size: number;
      chunk_hash: string;
      telegram_file_id: string;
      bot_id: string;
      bot_token_enc: string;
      channel_id: string | null;
    }>();

    if (originalChunks.results.length === 0) {
      return c.json({ error: 'File chunks not found' }, 404);
    }

    // Get user's active bots
    const userBots = await c.env.DB.prepare(`
      SELECT bot_id, bot_token_enc, channel_id
      FROM bots
      WHERE user_id = ? AND is_active = 1 AND health_status = 'healthy'
      ORDER BY last_health_check DESC
    `).bind(user.user_id).all<{
      bot_id: string;
      bot_token_enc: string;
      channel_id: string | null;
    }>();

    if (userBots.results.length === 0) {
      return c.json({ error: 'No active bots found. Please add a bot first.' }, 400);
    }

    // Create new file record
    const new_file_id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(`
      INSERT INTO files (
        file_id, user_id, file_name, file_path, file_size, mime_type,
        file_hash, chunk_count, forked_from_file, forked_from_user,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      new_file_id,
      user.user_id,
      originalFile.file_name,
      originalFile.file_path,
      originalFile.file_size,
      originalFile.mime_type,
      originalFile.file_hash,
      originalFile.chunk_count,
      originalFile.file_id,
      originalFile.original_user_id,
      now,
      now
    ).run();

    // Download chunks from original and re-upload to user's bots
    for (let i = 0; i < originalChunks.results.length; i++) {
      const originalChunk = originalChunks.results[i];
      const userBot = userBots.results[i % userBots.results.length];

      if (!userBot.channel_id) {
        throw new Error('Bot channel not configured');
      }

      // Download from original
      const chunkData = await downloadFile(originalChunk.bot_token_enc, originalChunk.telegram_file_id);

      // Upload to user's bot
      const result = await sendDocument(
        userBot.bot_token_enc,
        userBot.channel_id,
        chunkData,
        `chunk_${originalChunk.chunk_index}.bin`
      );

      // Save chunk metadata
      const chunk_id = `chunk_${new_file_id}_${originalChunk.chunk_index}`;
      await c.env.DB.prepare(`
        INSERT INTO chunks (
          chunk_id, file_id, chunk_index, chunk_size, chunk_hash,
          bot_id, telegram_message_id, telegram_file_id, channel_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        chunk_id,
        new_file_id,
        originalChunk.chunk_index,
        originalChunk.chunk_size,
        originalChunk.chunk_hash,
        userBot.bot_id,
        result.message_id,
        result.file_id,
        userBot.channel_id,
        now
      ).run();
    }

    // Increment fork count on original file
    await c.env.DB.prepare(`
      UPDATE files SET fork_count = fork_count + 1 WHERE file_id = ?
    `).bind(file_id).run();

    return c.json({
      success: true,
      file_id: new_file_id,
      message: 'File forked successfully',
    });
  } catch (error) {
    console.error('Fork error:', error);
    return c.json({ 
      error: 'Failed to fork file',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * POST /api/community/:file_id/view
 * Increment view count (for analytics)
 */
app.post('/:file_id/view', optionalAuthMiddleware, async (c) => {
  try {
    const file_id = c.req.param('file_id');

    // Verify file is public
    const file = await c.env.DB.prepare(
      'SELECT file_id FROM files WHERE file_id = ? AND is_public = 1 AND is_deleted = 0'
    ).bind(file_id).first();

    if (!file) {
      return c.json({ error: 'File not found or not public' }, 404);
    }

    // Increment view count
    await c.env.DB.prepare(`
      UPDATE files SET view_count = view_count + 1 WHERE file_id = ?
    `).bind(file_id).run();

    return c.json({ success: true });
  } catch (error) {
    console.error('View count error:', error);
    return c.json({ error: 'Failed to update view count' }, 500);
  }
});

export default app;
