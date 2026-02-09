/**
 * File Management Routes
 * Upload, download, stream, list, delete, update files
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { sendDocument, downloadFile, getFile } from '../services/telegram';
import { getCacheKey, getCached, setCached, shouldCache } from '../services/cache';

type Env = {
  DB: D1Database;
};

const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB

const app = new Hono<{ Bindings: Env }>();

// All routes require authentication
app.use('*', authMiddleware);

/**
 * POST /api/files/upload/init
 * Initialize file upload - create file record and return upload plan
 */
app.post('/upload/init', async (c) => {
  try {
    const user = c.get('user');
    const { 
      file_name, 
      file_size, 
      mime_type, 
      file_hash, 
      device_id,
      file_path,
      folder_id,
      is_public,
      public_title,
      public_category
    } = await c.req.json();

    if (!file_name || !file_size || !file_hash) {
      return c.json({ error: 'file_name, file_size, and file_hash required' }, 400);
    }

    // Check for duplicate (same hash)
    const existing = await c.env.DB.prepare(
      'SELECT file_id FROM files WHERE user_id = ? AND file_hash = ? AND is_deleted = 0'
    ).bind(user.user_id, file_hash).first();

    if (existing) {
      return c.json({ 
        error: 'File already exists',
        file_id: existing.file_id,
        duplicate: true
      }, 409);
    }

    // Calculate chunk count
    const chunk_count = Math.ceil(file_size / CHUNK_SIZE);

    // Get user's active bots
    const bots = await c.env.DB.prepare(`
      SELECT bot_id, bot_token_enc, channel_id
      FROM bots
      WHERE user_id = ? AND is_active = 1 AND health_status = 'healthy'
      ORDER BY last_health_check DESC
    `).bind(user.user_id).all<{
      bot_id: string;
      bot_token_enc: string;
      channel_id: string | null;
    }>();

    if (bots.results.length === 0) {
      return c.json({ error: 'No active bots found. Please add a bot first.' }, 400);
    }

    // Verify folder_id if provided
    if (folder_id) {
      const folder = await c.env.DB.prepare(`
        SELECT folder_id FROM folders WHERE folder_id = ? AND user_id = ?
      `).bind(folder_id, user.user_id).first();

      if (!folder) {
        return c.json({ error: 'Folder not found' }, 404);
      }
    }

    // Build file path based on folder
    let final_file_path = file_path || `/${file_name}`;
    if (folder_id) {
      const folder = await c.env.DB.prepare(`
        SELECT folder_path FROM folders WHERE folder_id = ? AND user_id = ?
      `).bind(folder_id, user.user_id).first<{ folder_path: string }>();

      if (folder) {
        final_file_path = `${folder.folder_path}/${file_name}`;
      }
    }

    // Create file record
    const file_id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(`
      INSERT INTO files (
        file_id, user_id, device_id, folder_id, file_name, file_path, file_size,
        mime_type, file_hash, chunk_count, is_public, public_title, public_category,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      file_id,
      user.user_id,
      device_id || null,
      folder_id || null,
      file_name,
      final_file_path,
      file_size,
      mime_type || null,
      file_hash,
      chunk_count,
      is_public ? 1 : 0,
      public_title || null,
      public_category || null,
      now,
      now
    ).run();

    // Assign bots to chunks (round-robin)
    const botAssignments = Array.from({ length: chunk_count }, (_, i) => ({
      chunk_index: i,
      bot_id: bots.results[i % bots.results.length].bot_id,
    }));

    return c.json({
      file_id,
      chunk_count,
      chunk_size: CHUNK_SIZE,
      bot_assignments: botAssignments,
    });
  } catch (error) {
    console.error('Upload init error:', error);
    return c.json({ error: 'Failed to initialize upload' }, 500);
  }
});

/**
 * POST /api/files/upload/chunk
 * Upload a single chunk
 */
app.post('/upload/chunk', async (c) => {
  try {
    const user = c.get('user');
    const { file_id, chunk_index, chunk_data, chunk_hash } = await c.req.json();

    if (!file_id || chunk_index === undefined || !chunk_data || !chunk_hash) {
      return c.json({ error: 'file_id, chunk_index, chunk_data, and chunk_hash required' }, 400);
    }

    // Verify file belongs to user
    const file = await c.env.DB.prepare(
      'SELECT file_id, chunk_count FROM files WHERE file_id = ? AND user_id = ?'
    ).bind(file_id, user.user_id).first<{ file_id: string; chunk_count: number }>();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    if (chunk_index >= file.chunk_count) {
      return c.json({ error: 'Invalid chunk_index' }, 400);
    }

    // Get bot for this chunk (from upload plan or round-robin)
    const bots = await c.env.DB.prepare(`
      SELECT bot_id, bot_token_enc, channel_id
      FROM bots
      WHERE user_id = ? AND is_active = 1 AND health_status = 'healthy'
      ORDER BY last_health_check DESC
    `).bind(user.user_id).all<{
      bot_id: string;
      bot_token_enc: string;
      channel_id: string | null;
    }>();

    if (bots.results.length === 0) {
      return c.json({ error: 'No active bots found' }, 400);
    }

    const selectedBot = bots.results[chunk_index % bots.results.length];

    if (!selectedBot.channel_id) {
      return c.json({ error: 'Bot channel not configured' }, 400);
    }

    // Decode base64 chunk data
    const chunkBuffer = Uint8Array.from(atob(chunk_data), c => c.charCodeAt(0));

    // Upload to Telegram
    console.log(`[uploadChunk] Uploading chunk ${chunk_index} for file ${file_id} to bot ${selectedBot.bot_id}, channel ${selectedBot.channel_id}`);
    const result = await sendDocument(
      selectedBot.bot_token_enc,
      selectedBot.channel_id,
      chunkBuffer,
      `chunk_${chunk_index}.bin`
    );

    console.log(`[uploadChunk] Upload successful:`, {
      chunk_index,
      message_id: result.message_id,
      file_id: result.file_id,
      file_id_length: result.file_id.length
    });

    // Verify the file_id can be retrieved immediately (test)
    try {
      const testFile = await getFile(selectedBot.bot_token_enc, result.file_id);
      console.log(`[uploadChunk] Verified file_id is retrievable:`, {
        file_id: testFile.file_id,
        file_path: testFile.file_path,
        file_size: testFile.file_size
      });
    } catch (verifyError) {
      console.error(`[uploadChunk] WARNING: File_id verification failed:`, verifyError);
      // Continue anyway - might be a timing issue
    }

    // Save chunk metadata
    const chunk_id = `chunk_${file_id}_${chunk_index}`;
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(`
      INSERT INTO chunks (
        chunk_id, file_id, chunk_index, chunk_size, chunk_hash,
        bot_id, telegram_message_id, telegram_file_id, channel_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      chunk_id,
      file_id,
      chunk_index,
      chunkBuffer.length,
      chunk_hash,
      selectedBot.bot_id,
      result.message_id,
      result.file_id,
      selectedBot.channel_id,
      now
    ).run();

    console.log(`[uploadChunk] Stored chunk in DB:`, {
      chunk_id,
      file_id,
      chunk_index,
      bot_id: selectedBot.bot_id,
      channel_id: selectedBot.channel_id,
      telegram_file_id: result.file_id,
      telegram_message_id: result.message_id
    });

    return c.json({
      success: true,
      chunk_index,
      message_id: result.message_id,
      file_id: result.file_id,
    });
  } catch (error) {
    console.error('Upload chunk error:', error);
    return c.json({ 
      error: 'Failed to upload chunk',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * POST /api/files/upload/complete
 * Mark upload as complete
 */
app.post('/upload/complete', async (c) => {
  try {
    const user = c.get('user');
    const { file_id } = await c.req.json();

    if (!file_id) {
      return c.json({ error: 'file_id required' }, 400);
    }

    // Verify file belongs to user
    const file = await c.env.DB.prepare(
      'SELECT file_id, chunk_count FROM files WHERE file_id = ? AND user_id = ?'
    ).bind(file_id, user.user_id).first<{ file_id: string; chunk_count: number }>();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Verify all chunks uploaded
    const chunks = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM chunks WHERE file_id = ?'
    ).bind(file_id).first<{ count: number }>();

    if (chunks?.count !== file.chunk_count) {
      return c.json({ 
        error: 'Not all chunks uploaded',
        uploaded: chunks?.count || 0,
        required: file.chunk_count
      }, 400);
    }

    // Update file updated_at
    await c.env.DB.prepare(`
      UPDATE files SET updated_at = ? WHERE file_id = ?
    `).bind(Math.floor(Date.now() / 1000), file_id).run();

    return c.json({
      success: true,
      file_id,
      message: 'Upload complete',
    });
  } catch (error) {
    console.error('Upload complete error:', error);
    return c.json({ error: 'Failed to complete upload' }, 500);
  }
});

/**
 * GET /api/files/list
 * List files with filters
 */
app.get('/list', async (c) => {
  try {
    const user = c.get('user');
    const device_id = c.req.query('device_id');
    const folder_path = c.req.query('folder_path');
    const mime_type = c.req.query('mime_type');
    const is_public = c.req.query('is_public');
    const search = c.req.query('search'); // Search query
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');

    let query = `
      SELECT 
        file_id, file_name, file_path, file_size, mime_type,
        chunk_count, folder_id, is_public, public_title, public_category,
        view_count, fork_count, created_at, updated_at
      FROM files
      WHERE user_id = ? AND is_deleted = 0
    `;
    const params: any[] = [user.user_id];

    if (device_id) {
      query += ' AND device_id = ?';
      params.push(device_id);
    }

    const folder_id = c.req.query('folder_id');
    if (folder_id !== undefined) {
      if (folder_id === null || folder_id === '') {
        query += ' AND folder_id IS NULL';
      } else {
        query += ' AND folder_id = ?';
        params.push(folder_id);
      }
    }

    if (folder_path) {
      query += ' AND file_path LIKE ?';
      params.push(`${folder_path}%`);
    }

    if (mime_type) {
      query += ' AND mime_type LIKE ?';
      params.push(`${mime_type}%`);
    }

    if (is_public !== undefined) {
      query += ' AND is_public = ?';
      params.push(is_public === 'true' ? 1 : 0);
    }

    // Search functionality
    if (search && search.trim()) {
      query += ' AND (file_name LIKE ? OR file_path LIKE ?)';
      const searchTerm = `%${search.trim()}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const files = await c.env.DB.prepare(query).bind(...params).all<{
      file_id: string;
      file_name: string;
      file_path: string;
      file_size: number;
      mime_type: string | null;
      chunk_count: number;
      folder_id: string | null;
      is_public: number;
      public_title: string | null;
      public_category: string | null;
      view_count: number;
      fork_count: number;
      created_at: number;
      updated_at: number;
    }>();

    return c.json({
      files: files.results.map(f => ({
        file_id: f.file_id,
        file_name: f.file_name,
        file_path: f.file_path,
        file_size: f.file_size,
        mime_type: f.mime_type,
        chunk_count: f.chunk_count,
        folder_id: f.folder_id,
        is_public: f.is_public === 1,
        public_title: f.public_title,
        public_category: f.public_category,
        view_count: f.view_count,
        fork_count: f.fork_count,
        created_at: f.created_at,
        updated_at: f.updated_at,
      })),
      total: files.results.length,
    });
  } catch (error) {
    console.error('List files error:', error);
    return c.json({ error: 'Failed to list files' }, 500);
  }
});

/**
 * GET /api/files/:file_id
 * Get file metadata
 */
app.get('/:file_id', async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');

    const file = await c.env.DB.prepare(`
      SELECT 
        file_id, file_name, file_path, file_size, mime_type, file_hash,
        chunk_count, is_encrypted, is_public, public_title, public_category,
        view_count, fork_count, created_at, updated_at
      FROM files
      WHERE file_id = ? AND user_id = ? AND is_deleted = 0
    `).bind(file_id, user.user_id).first<{
      file_id: string;
      file_name: string;
      file_path: string;
      file_size: number;
      mime_type: string | null;
      file_hash: string;
      chunk_count: number;
      is_encrypted: number;
      is_public: number;
      public_title: string | null;
      public_category: string | null;
      view_count: number;
      fork_count: number;
      created_at: number;
      updated_at: number;
    }>();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    return c.json({
      file_id: file.file_id,
      file_name: file.file_name,
      file_path: file.file_path,
      file_size: file.file_size,
      mime_type: file.mime_type,
      chunk_count: file.chunk_count,
      is_encrypted: file.is_encrypted === 1,
      is_public: file.is_public === 1,
      public_title: file.public_title,
      public_category: file.public_category,
      view_count: file.view_count,
      fork_count: file.fork_count,
      created_at: file.created_at,
      updated_at: file.updated_at,
    });
  } catch (error) {
    console.error('Get file error:', error);
    return c.json({ error: 'Failed to get file' }, 500);
  }
});

/**
 * GET /api/files/:file_id/download
 * Download file (assembled from chunks)
 */
app.get('/:file_id/download', async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');

    // Get file metadata
    const file = await c.env.DB.prepare(`
      SELECT file_id, file_name, file_size, mime_type
      FROM files
      WHERE file_id = ? AND user_id = ? AND is_deleted = 0
    `).bind(file_id, user.user_id).first<{
      file_id: string;
      file_name: string;
      file_size: number;
      mime_type: string | null;
    }>();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Get chunks in order (only from active bots with channels)
    // Also get telegram_message_id for fallback retrieval
    const chunks = await c.env.DB.prepare(`
      SELECT 
        chunk_index, telegram_file_id, telegram_message_id, chunks.bot_id, bot_token_enc, 
        chunks.channel_id as stored_channel_id, bots.channel_id as bot_channel_id
      FROM chunks
      JOIN bots ON chunks.bot_id = bots.bot_id
      WHERE chunks.file_id = ? AND bots.is_active = 1 AND bots.channel_id IS NOT NULL
      ORDER BY chunk_index ASC
    `).bind(file_id).all<{
      chunk_index: number;
      telegram_file_id: string;
      telegram_message_id: number;
      bot_id: string;
      bot_token_enc: string;
      stored_channel_id: string | null;
      bot_channel_id: string | null;
    }>();

    if (chunks.results.length === 0) {
      // Check if chunks exist but bots are inactive
      const allChunks = await c.env.DB.prepare(`
        SELECT COUNT(*) as count FROM chunks WHERE file_id = ?
      `).bind(file_id).first<{ count: number }>();
      
      if (allChunks && allChunks.count > 0) {
        return c.json({ 
          error: 'File chunks found but bot is inactive or channel not configured',
          message: 'Please ensure your bot is active and has a channel configured'
        }, 503);
      }
      return c.json({ error: 'File chunks not found' }, 404);
    }

    // Download and assemble chunks
    const chunkBuffers: ArrayBuffer[] = [];
    for (const chunk of chunks.results) {
      try {
        console.log(`[download] Chunk ${chunk.chunk_index}:`, {
          bot_id: chunk.bot_id,
          stored_channel_id: chunk.stored_channel_id,
          bot_channel_id: chunk.bot_channel_id,
          file_id: chunk.telegram_file_id.substring(0, 30) + '...',
          token_preview: chunk.bot_token_enc.substring(0, 10) + '...'
        });
        
        // Verify bot token is not empty
        if (!chunk.bot_token_enc || chunk.bot_token_enc.trim().length === 0) {
          throw new Error('Bot token is empty or invalid');
        }
        
        let chunkData: ArrayBuffer;
        try {
          // Verify bot token first
          const { getBotInfo } = await import('../services/telegram');
          try {
            const botInfo = await getBotInfo(chunk.bot_token_enc);
            console.log(`[download] Bot verified: ${botInfo.username} (ID: ${botInfo.id})`);
          } catch (botVerifyError) {
            console.error(`[download] Bot token verification failed:`, botVerifyError);
            throw new Error(`Bot token is invalid or expired. Please re-add the bot in Settings.`);
          }
          
          // Try downloading with stored file_id
          chunkData = await downloadFile(chunk.bot_token_enc, chunk.telegram_file_id);
        } catch (fileIdError) {
          // If file_id fails, try to get file from message (fallback)
          const errorMsg = fileIdError instanceof Error ? fileIdError.message : 'Unknown error';
          console.warn(`[download] File_id failed for chunk ${chunk.chunk_index}: ${errorMsg}`);
          console.warn(`[download] Attempting message_id fallback...`);
          
          const { getFileFromMessage } = await import('../services/telegram');
          const channelId = chunk.stored_channel_id || chunk.bot_channel_id;
          
          if (!channelId) {
            throw new Error(`Channel ID not found for chunk ${chunk.chunk_index}`);
          }
          
          if (!chunk.telegram_message_id) {
            throw new Error(`Message ID not found for chunk ${chunk.chunk_index}`);
          }
          
          try {
            const fileFromMessage = await getFileFromMessage(
              chunk.bot_token_enc,
              channelId,
              chunk.telegram_message_id
            );
            
            if (fileFromMessage && fileFromMessage.file_path) {
              // Update stored file_id for future use
              const chunk_id = `chunk_${file_id}_${chunk.chunk_index}`;
              await c.env.DB.prepare(`
                UPDATE chunks SET telegram_file_id = ? WHERE chunk_id = ?
              `).bind(fileFromMessage.file_id, chunk_id).run();
              
              console.log(`[download] Updated file_id for chunk ${chunk.chunk_index} from message`);
              chunkData = await downloadFile(chunk.bot_token_enc, fileFromMessage.file_id);
              console.log(`[download] Successfully retrieved chunk ${chunk.chunk_index} using message_id fallback`);
            } else {
              throw new Error(`Could not retrieve file from message ${chunk.telegram_message_id}. The message may have been deleted.`);
            }
          } catch (fallbackError) {
            const fallbackMsg = fallbackError instanceof Error ? fallbackError.message : 'Unknown error';
            console.error(`[download] Fallback also failed for chunk ${chunk.chunk_index}:`, fallbackMsg);
            throw new Error(`Failed to retrieve chunk ${chunk.chunk_index}. Original error: ${errorMsg}. Fallback error: ${fallbackMsg}`);
          }
        }
        
        chunkBuffers.push(chunkData);
      } catch (chunkError) {
        console.error(`Failed to download chunk ${chunk.chunk_index} (file_id: ${file_id}):`, chunkError);
        console.error(`Chunk details:`, {
          bot_id: chunk.bot_id,
          stored_channel_id: chunk.stored_channel_id,
          bot_channel_id: chunk.bot_channel_id,
          telegram_file_id: chunk.telegram_file_id,
          token_length: chunk.bot_token_enc?.length || 0
        });
        const errorMessage = chunkError instanceof Error ? chunkError.message : 'Telegram API error';
        
        // Check if it's a file not found error - might need to re-upload
        if (errorMessage.includes('file not found') || errorMessage.includes('404') || errorMessage.includes('400')) {
          return c.json({ 
            error: 'File chunk not found in Telegram',
            message: `Chunk ${chunk.chunk_index} appears to be missing. The file may need to be re-uploaded.`,
            chunk_index: chunk.chunk_index,
            suggestion: 'Try re-uploading this file',
            debug: {
              bot_id: chunk.bot_id,
              stored_channel_id: chunk.stored_channel_id,
              bot_channel_id: chunk.bot_channel_id,
              file_id_preview: chunk.telegram_file_id.substring(0, 30)
            }
          }, 404);
        }
        
        return c.json({ 
          error: 'Failed to download file chunk',
          message: errorMessage,
          chunk_index: chunk.chunk_index
        }, 500);
      }
    }

    // Combine chunks
    const totalLength = chunkBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of chunkBuffers) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    // Return file
    return new Response(combined.buffer, {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.file_name}"`,
        'Content-Length': combined.length.toString(),
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ 
      error: 'Failed to download file',
      message: errorMessage,
      details: error instanceof Error ? error.stack : undefined
    }, 500);
  }
});

/**
 * GET /api/files/:file_id/stream
 * Stream file (with Range support for video seeking and Cache API)
 */
app.get('/:file_id/stream', async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');
    const range = c.req.header('Range');

    // Get file metadata
    const file = await c.env.DB.prepare(`
      SELECT file_id, file_name, file_size, mime_type
      FROM files
      WHERE file_id = ? AND user_id = ? AND is_deleted = 0
    `).bind(file_id, user.user_id).first<{
      file_id: string;
      file_name: string;
      file_size: number;
      mime_type: string | null;
    }>();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Get chunks (only from active bots with channels)
    const chunks = await c.env.DB.prepare(`
      SELECT 
        chunk_index, chunk_size, telegram_file_id, chunks.bot_id, bot_token_enc,
        chunks.channel_id as stored_channel_id, bots.channel_id as bot_channel_id
      FROM chunks
      JOIN bots ON chunks.bot_id = bots.bot_id
      WHERE chunks.file_id = ? AND bots.is_active = 1 AND bots.channel_id IS NOT NULL
      ORDER BY chunk_index ASC
    `).bind(file_id).all<{
      chunk_index: number;
      chunk_size: number;
      telegram_file_id: string;
      bot_id: string;
      bot_token_enc: string;
      stored_channel_id: string | null;
      bot_channel_id: string | null;
    }>();

    if (chunks.results.length === 0) {
      // Check if chunks exist but bots are inactive
      const allChunks = await c.env.DB.prepare(`
        SELECT COUNT(*) as count FROM chunks WHERE file_id = ?
      `).bind(file_id).first<{ count: number }>();
      
      if (allChunks && allChunks.count > 0) {
        return c.json({ 
          error: 'File chunks found but bot is inactive or channel not configured',
          message: 'Please ensure your bot is active and has a channel configured'
        }, 503);
      }
      return c.json({ error: 'File chunks not found' }, 404);
    }

    // Handle Range request (for video seeking)
    if (range) {
      const [start, end] = parseRange(range, file.file_size);
      const cacheKey = getCacheKey(file_id, 0, { start, end });
      
      // Check cache first
      const cache = caches.default;
      if (shouldCache(file.mime_type)) {
        const cached = await getCached(cacheKey, cache);
        if (cached) {
          return cached;
        }
      }
      
      // Find which chunks contain the range
      let chunkStart = 0;
      const neededChunks: Array<{
        chunk: typeof chunks.results[0];
        extractStart: number;
        extractEnd: number;
        globalStart: number;
        globalEnd: number;
      }> = [];
      
      for (const chunk of chunks.results) {
        const chunkEnd = chunkStart + chunk.chunk_size;
        
        if (chunkEnd > start && chunkStart <= end) {
          const extractStart = Math.max(0, start - chunkStart);
          const extractEnd = Math.min(chunk.chunk_size, end - chunkStart + 1);
          neededChunks.push({
            chunk,
            extractStart,
            extractEnd,
            globalStart: chunkStart,
            globalEnd: chunkEnd,
          });
        }
        
        chunkStart = chunkEnd;
      }
      
      // Download and extract needed portions
      const parts: Uint8Array[] = [];
      for (const needed of neededChunks) {
        try {
          const chunkData = await downloadFile(needed.chunk.bot_token_enc, needed.chunk.telegram_file_id);
          const chunkArray = new Uint8Array(chunkData);
          const extracted = chunkArray.slice(needed.extractStart, needed.extractEnd);
          parts.push(extracted);
        } catch (chunkError) {
          console.error(`Failed to download chunk ${needed.chunk.chunk_index} for range (file_id: ${file_id}):`, chunkError);
          const errorMessage = chunkError instanceof Error ? chunkError.message : 'Telegram API error';
          
          // Check if it's a file not found error
          if (errorMessage.includes('file not found') || errorMessage.includes('404')) {
            return c.json({ 
              error: 'File chunk not found in Telegram',
              message: `Chunk ${needed.chunk.chunk_index} appears to be missing. The file may need to be re-uploaded.`,
              chunk_index: needed.chunk.chunk_index,
              suggestion: 'Try re-uploading this file'
            }, 404);
          }
          
          return c.json({ 
            error: 'Failed to stream file chunk',
            message: errorMessage,
            chunk_index: needed.chunk.chunk_index
          }, 500);
        }
      }
      
      // Combine parts
      const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of parts) {
        combined.set(part, offset);
        offset += part.length;
      }
      
      const response = new Response(combined.buffer, {
        status: 206,
        headers: {
          'Content-Type': file.mime_type || 'application/octet-stream',
          'Content-Range': `bytes ${start}-${end}/${file.file_size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': combined.length.toString(),
        },
      });
      
      // Cache the response
      if (shouldCache(file.mime_type)) {
        await setCached(cacheKey, response.clone(), cache);
      }
      
      return response;
    }

    // No range or full file - download all chunks
    const cache = caches.default;
    const cacheKey = getCacheKey(file_id, 0);
    
    // Check cache first
    if (shouldCache(file.mime_type)) {
      const cached = await getCached(cacheKey, cache);
      if (cached) {
        return cached;
      }
    }

    const chunkBuffers: ArrayBuffer[] = [];
    for (const chunk of chunks.results) {
      try {
        const chunkData = await downloadFile(chunk.bot_token_enc, chunk.telegram_file_id);
        chunkBuffers.push(chunkData);
      } catch (chunkError) {
        console.error(`Failed to download chunk ${chunk.chunk_index} (file_id: ${file_id}):`, chunkError);
        const errorMessage = chunkError instanceof Error ? chunkError.message : 'Telegram API error';
        
        // Check if it's a file not found error
        if (errorMessage.includes('file not found') || errorMessage.includes('404')) {
          return c.json({ 
            error: 'File chunk not found in Telegram',
            message: `Chunk ${chunk.chunk_index} appears to be missing. The file may need to be re-uploaded.`,
            chunk_index: chunk.chunk_index,
            suggestion: 'Try re-uploading this file'
          }, 404);
        }
        
        return c.json({ 
          error: 'Failed to stream file chunk',
          message: errorMessage,
          chunk_index: chunk.chunk_index
        }, 500);
      }
    }

    // Combine chunks
    const totalLength = chunkBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of chunkBuffers) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    const response = new Response(combined.buffer, {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Length': combined.length.toString(),
        'Accept-Ranges': 'bytes',
      },
    });
    
    // Cache the response
    if (shouldCache(file.mime_type)) {
      await setCached(cacheKey, response.clone(), cache);
    }
    
    return response;
  } catch (error) {
    console.error('Stream error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ 
      error: 'Failed to stream file',
      message: errorMessage,
      details: error instanceof Error ? error.stack : undefined
    }, 500);
  }
});

/**
 * Parse Range header
 */
function parseRange(range: string, fileSize: number): [number, number] {
  const match = range.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return [0, fileSize - 1];
  }

  const start = parseInt(match[1]);
  const end = match[2] ? parseInt(match[2]) : fileSize - 1;

  return [start, Math.min(end, fileSize - 1)];
}

/**
 * DELETE /api/files/:file_id
 * Delete file (soft delete)
 */
app.delete('/:file_id', async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');

    // Verify file belongs to user
    const file = await c.env.DB.prepare(
      'SELECT file_id FROM files WHERE file_id = ? AND user_id = ?'
    ).bind(file_id, user.user_id).first();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Soft delete
    await c.env.DB.prepare(`
      UPDATE files SET is_deleted = 1, updated_at = ? WHERE file_id = ?
    `).bind(Math.floor(Date.now() / 1000), file_id).run();

    return c.json({ success: true, message: 'File deleted' });
  } catch (error) {
    console.error('Delete file error:', error);
    return c.json({ error: 'Failed to delete file' }, 500);
  }
});

/**
 * PUT /api/files/:file_id
 * Update file (rename, move, toggle public)
 */
app.put('/:file_id', async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');
    const { file_name, folder_id, file_path, is_public, public_title, public_category } = await c.req.json();

    // Verify file belongs to user
    const file = await c.env.DB.prepare(
      'SELECT file_id, file_name FROM files WHERE file_id = ? AND user_id = ? AND is_deleted = 0'
    ).bind(file_id, user.user_id).first<{
      file_id: string;
      file_name: string;
    }>();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Verify folder_id if provided
    if (folder_id !== undefined && folder_id !== null) {
      const folder = await c.env.DB.prepare(`
        SELECT folder_id, folder_path FROM folders WHERE folder_id = ? AND user_id = ?
      `).bind(folder_id, user.user_id).first<{
        folder_id: string;
        folder_path: string;
      }>();

      if (!folder) {
        return c.json({ error: 'Folder not found' }, 404);
      }
    }

    // Build update query
    const updates: string[] = [];
    const params: any[] = [];

    if (file_name !== undefined) {
      updates.push('file_name = ?');
      params.push(file_name);
    }

    if (folder_id !== undefined) {
      updates.push('folder_id = ?');
      params.push(folder_id || null);
      
      // Update file_path based on new folder
      const finalFileName = file_name || file.file_name;
      if (folder_id) {
        const folder = await c.env.DB.prepare(`
          SELECT folder_path FROM folders WHERE folder_id = ? AND user_id = ?
        `).bind(folder_id, user.user_id).first<{ folder_path: string }>();

        if (folder) {
          updates.push('file_path = ?');
          params.push(`${folder.folder_path}/${finalFileName}`);
        }
      } else {
        // Moving to root
        updates.push('file_path = ?');
        params.push(`/${finalFileName}`);
      }
    } else if (file_path !== undefined) {
      updates.push('file_path = ?');
      params.push(file_path);
    }

    if (is_public !== undefined) {
      updates.push('is_public = ?');
      params.push(is_public ? 1 : 0);
    }

    if (public_title !== undefined) {
      updates.push('public_title = ?');
      params.push(public_title);
    }

    if (public_category !== undefined) {
      updates.push('public_category = ?');
      params.push(public_category);
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400);
    }

    updates.push('updated_at = ?');
    params.push(Math.floor(Date.now() / 1000));
    params.push(file_id);

    await c.env.DB.prepare(`
      UPDATE files SET ${updates.join(', ')} WHERE file_id = ?
    `).bind(...params).run();

    return c.json({ success: true, message: 'File updated' });
  } catch (error) {
    console.error('Update file error:', error);
    return c.json({ error: 'Failed to update file' }, 500);
  }
});

export default app;
