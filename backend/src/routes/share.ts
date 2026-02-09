/**
 * Share Routes
 * Create, get, download, stream, and revoke share links
 */

import { Hono } from 'hono';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth';
import { downloadFile } from '../services/telegram';
import { hashJWT } from '../services/auth';

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/share/create
 * Create a share link
 */
app.post('/create', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { file_id, password, expires_at, max_downloads } = await c.req.json();

    if (!file_id) {
      return c.json({ error: 'file_id required' }, 400);
    }

    // Verify file belongs to user
    const file = await c.env.DB.prepare(
      'SELECT file_id FROM files WHERE file_id = ? AND user_id = ? AND is_deleted = 0'
    ).bind(file_id, user.user_id).first();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Generate share ID
    const share_id = Math.random().toString(36).substring(2, 15);
    const password_hash = password ? await hashJWT(password) : null;
    const expires_at_timestamp = expires_at ? Math.floor(new Date(expires_at).getTime() / 1000) : null;
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(`
      INSERT INTO shares (
        share_id, file_id, user_id, password_hash, expires_at, max_downloads, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      share_id,
      file_id,
      user.user_id,
      password_hash,
      expires_at_timestamp,
      max_downloads || null,
      now
    ).run();

    return c.json({
      share_id,
      share_url: `/s/${share_id}`,
      expires_at: expires_at_timestamp,
      max_downloads,
    });
  } catch (error) {
    console.error('Create share error:', error);
    return c.json({ error: 'Failed to create share link' }, 500);
  }
});

/**
 * GET /api/share/:share_id
 * Get shared file info (public, no auth needed)
 */
app.get('/:share_id', optionalAuthMiddleware, async (c) => {
  try {
    const share_id = c.req.param('share_id');

    if (!share_id || share_id.trim().length === 0) {
      return c.json({ error: 'Share ID is required' }, 400);
    }

    const share = await c.env.DB.prepare(`
      SELECT 
        share_id, file_id, user_id, expires_at, max_downloads,
        download_count, is_active, created_at
      FROM shares
      WHERE share_id = ? AND is_active = 1
    `).bind(share_id.trim()).first<{
      share_id: string;
      file_id: string;
      user_id: string;
      expires_at: number | null;
      max_downloads: number | null;
      download_count: number;
      is_active: number;
      created_at: number;
    }>();

    if (!share) {
      // Check if share exists but is inactive
      const inactiveShare = await c.env.DB.prepare(`
        SELECT share_id FROM shares WHERE share_id = ?
      `).bind(share_id.trim()).first();
      
      if (inactiveShare) {
        return c.json({ error: 'Share link has been revoked' }, 410);
      }
      return c.json({ error: 'Share not found' }, 404);
    }

    // Check expiry
    if (share.expires_at && Date.now() / 1000 > share.expires_at) {
      return c.json({ error: 'Share link expired' }, 410);
    }

    // Check download limit
    if (share.max_downloads && share.download_count >= share.max_downloads) {
      return c.json({ error: 'Download limit reached' }, 410);
    }

    // Get file info
    const file = await c.env.DB.prepare(`
      SELECT 
        file_id, file_name, file_size, mime_type, is_public,
        public_title, public_category, created_at
      FROM files
      WHERE file_id = ? AND is_deleted = 0
    `).bind(share.file_id).first<{
      file_id: string;
      file_name: string;
      file_size: number;
      mime_type: string | null;
      is_public: number;
      public_title: string | null;
      public_category: string | null;
      created_at: number;
    }>();

    if (!file) {
      return c.json({ error: 'File not found' }, 404);
    }

    return c.json({
      share_id: share.share_id,
      file: {
        file_id: file.file_id,
        file_name: file.file_name,
        file_size: file.file_size,
        mime_type: file.mime_type,
        created_at: file.created_at,
      },
      has_password: false, // Don't reveal if password exists
      expires_at: share.expires_at,
      max_downloads: share.max_downloads,
      download_count: share.download_count,
    });
  } catch (error) {
    console.error('Get share error:', error);
    return c.json({ error: 'Failed to get share info' }, 500);
  }
});

/**
 * GET /api/share/:share_id/download
 * Download shared file
 */
app.get('/:share_id/download', optionalAuthMiddleware, async (c) => {
  try {
    const share_id = c.req.param('share_id');
    const password = c.req.query('password');

    const share = await c.env.DB.prepare(`
      SELECT 
        share_id, file_id, user_id, password_hash, expires_at, max_downloads,
        download_count, is_active
      FROM shares
      WHERE share_id = ? AND is_active = 1
    `).bind(share_id).first<{
      share_id: string;
      file_id: string;
      user_id: string;
      password_hash: string | null;
      expires_at: number | null;
      max_downloads: number | null;
      download_count: number;
      is_active: number;
    }>();

    if (!share) {
      return c.json({ error: 'Share not found' }, 404);
    }

    // Check expiry
    if (share.expires_at && Date.now() / 1000 > share.expires_at) {
      return c.json({ error: 'Share link expired' }, 410);
    }

    // Check password
    if (share.password_hash) {
      if (!password) {
        return c.json({ error: 'Password required' }, 401);
      }
      const password_hash = await hashJWT(password);
      if (password_hash !== share.password_hash) {
        return c.json({ error: 'Invalid password' }, 401);
      }
    }

    // Check download limit
    if (share.max_downloads && share.download_count >= share.max_downloads) {
      return c.json({ error: 'Download limit reached' }, 410);
    }

    // Get file and chunks (same as files download)
    const file = await c.env.DB.prepare(`
      SELECT file_id, file_name, file_size, mime_type
      FROM files
      WHERE file_id = ? AND is_deleted = 0
    `).bind(share.file_id).first<{
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
        chunk_index, telegram_file_id, chunks.bot_id, bot_token_enc
      FROM chunks
      JOIN bots ON chunks.bot_id = bots.bot_id
      WHERE chunks.file_id = ? AND bots.is_active = 1 AND bots.channel_id IS NOT NULL
      ORDER BY chunk_index ASC
    `).bind(share.file_id).all<{
      chunk_index: number;
      telegram_file_id: string;
      bot_id: string;
      bot_token_enc: string;
    }>();

    if (chunks.results.length === 0) {
      const allChunks = await c.env.DB.prepare(`
        SELECT COUNT(*) as count FROM chunks WHERE file_id = ?
      `).bind(share.file_id).first<{ count: number }>();
      
      if (allChunks && allChunks.count > 0) {
        return c.json({ 
          error: 'File chunks found but bot is inactive or channel not configured',
          message: 'The file owner needs to configure their bot channel'
        }, 503);
      }
      return c.json({ error: 'File chunks not found' }, 404);
    }

    // Download and assemble chunks
    const chunkBuffers: ArrayBuffer[] = [];
    for (const chunk of chunks.results) {
      try {
        const chunkData = await downloadFile(chunk.bot_token_enc, chunk.telegram_file_id);
        chunkBuffers.push(chunkData);
      } catch (chunkError) {
        console.error(`Failed to download chunk ${chunk.chunk_index} (share_id: ${share_id}):`, chunkError);
        const errorMessage = chunkError instanceof Error ? chunkError.message : 'Telegram API error';
        
        // Check if it's a file not found error
        if (errorMessage.includes('file not found') || errorMessage.includes('404')) {
          return c.json({ 
            error: 'File chunk not found in Telegram',
            message: `The shared file appears to be missing. The file owner may need to re-upload it.`,
            chunk_index: chunk.chunk_index
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

    // Increment download count
    await c.env.DB.prepare(`
      UPDATE shares SET download_count = download_count + 1 WHERE share_id = ?
    `).bind(share_id).run();

    return new Response(combined.buffer, {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.file_name}"`,
        'Content-Length': combined.length.toString(),
      },
    });
  } catch (error) {
    console.error('Download share error:', error);
    return c.json({ error: 'Failed to download shared file' }, 500);
  }
});

/**
 * GET /api/share/:share_id/stream
 * Stream shared file (with Range support for video seeking)
 */
app.get('/:share_id/stream', optionalAuthMiddleware, async (c) => {
  try {
    const share_id = c.req.param('share_id');
    const password = c.req.query('password');

    const share = await c.env.DB.prepare(`
      SELECT 
        share_id, file_id, user_id, password_hash, expires_at, max_downloads,
        download_count, is_active
      FROM shares
      WHERE share_id = ? AND is_active = 1
    `).bind(share_id).first<{
      share_id: string;
      file_id: string;
      user_id: string;
      password_hash: string | null;
      expires_at: number | null;
      max_downloads: number | null;
      download_count: number;
      is_active: number;
    }>();

    if (!share) {
      return c.json({ error: 'Share not found' }, 404);
    }

    // Check expiry
    if (share.expires_at && Date.now() / 1000 > share.expires_at) {
      return c.json({ error: 'Share link expired' }, 410);
    }

    // Check password
    if (share.password_hash) {
      if (!password) {
        return c.json({ error: 'Password required' }, 401);
      }
      const password_hash = await hashJWT(password);
      if (password_hash !== share.password_hash) {
        return c.json({ error: 'Invalid password' }, 401);
      }
    }

    // Get file metadata
    const file = await c.env.DB.prepare(`
      SELECT file_id, file_name, file_size, mime_type
      FROM files
      WHERE file_id = ? AND is_deleted = 0
    `).bind(share.file_id).first<{
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
        chunk_index, chunk_size, telegram_file_id, chunks.bot_id, bot_token_enc
      FROM chunks
      JOIN bots ON chunks.bot_id = bots.bot_id
      WHERE chunks.file_id = ? AND bots.is_active = 1 AND bots.channel_id IS NOT NULL
      ORDER BY chunk_index ASC
    `).bind(share.file_id).all<{
      chunk_index: number;
      chunk_size: number;
      telegram_file_id: string;
      bot_id: string;
      bot_token_enc: string;
    }>();

    if (chunks.results.length === 0) {
      const allChunks = await c.env.DB.prepare(`
        SELECT COUNT(*) as count FROM chunks WHERE file_id = ?
      `).bind(share.file_id).first<{ count: number }>();
      
      if (allChunks && allChunks.count > 0) {
        return c.json({ 
          error: 'File chunks found but bot is inactive or channel not configured',
          message: 'The file owner needs to configure their bot channel'
        }, 503);
      }
      return c.json({ error: 'File chunks not found' }, 404);
    }

    const range = c.req.header('Range');

    if (range) {
      // Parse Range header
      const match = range.match(/bytes=(\d+)-(\d*)/);
      const start = match ? parseInt(match[1]) : 0;
      const end = match && match[2] ? parseInt(match[2]) : file.file_size - 1;
      const rangeEnd = Math.min(end, file.file_size - 1);

      // Find which chunks contain the range
      let chunkStart = 0;
      const neededChunks: Array<{
        chunk: typeof chunks.results[0];
        extractStart: number;
        extractEnd: number;
      }> = [];

      for (const chunk of chunks.results) {
        const chunkEnd = chunkStart + chunk.chunk_size;
        if (chunkEnd > start && chunkStart <= rangeEnd) {
          neededChunks.push({
            chunk,
            extractStart: Math.max(0, start - chunkStart),
            extractEnd: Math.min(chunk.chunk_size, rangeEnd - chunkStart + 1),
          });
        }
        chunkStart = chunkEnd;
      }

      const parts: Uint8Array[] = [];
      for (const needed of neededChunks) {
        try {
          const chunkData = await downloadFile(needed.chunk.bot_token_enc, needed.chunk.telegram_file_id);
          const chunkArray = new Uint8Array(chunkData);
          parts.push(chunkArray.slice(needed.extractStart, needed.extractEnd));
        } catch (chunkError) {
          console.error(`Failed to download chunk ${needed.chunk.chunk_index} for range (share_id: ${share_id}):`, chunkError);
          const errorMessage = chunkError instanceof Error ? chunkError.message : 'Telegram API error';
          
          // Check if it's a file not found error
          if (errorMessage.includes('file not found') || errorMessage.includes('404')) {
            return c.json({ 
              error: 'File chunk not found in Telegram',
              message: `The shared file appears to be missing. The file owner may need to re-upload it.`,
              chunk_index: needed.chunk.chunk_index
            }, 404);
          }
          
          return c.json({ 
            error: 'Failed to stream file chunk',
            message: errorMessage,
            chunk_index: needed.chunk.chunk_index
          }, 500);
        }
      }

      const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const part of parts) {
        combined.set(part, offset);
        offset += part.length;
      }

      return new Response(combined.buffer, {
        status: 206,
        headers: {
          'Content-Type': file.mime_type || 'application/octet-stream',
          'Content-Range': `bytes ${start}-${rangeEnd}/${file.file_size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': combined.length.toString(),
        },
      });
    }

    // No range - stream full file
    const chunkBuffers: ArrayBuffer[] = [];
    for (const chunk of chunks.results) {
      try {
        const chunkData = await downloadFile(chunk.bot_token_enc, chunk.telegram_file_id);
        chunkBuffers.push(chunkData);
      } catch (chunkError) {
        console.error(`Failed to download chunk ${chunk.chunk_index} (share_id: ${share_id}):`, chunkError);
        const errorMessage = chunkError instanceof Error ? chunkError.message : 'Telegram API error';
        
        // Check if it's a file not found error
        if (errorMessage.includes('file not found') || errorMessage.includes('404')) {
          return c.json({ 
            error: 'File chunk not found in Telegram',
            message: `The shared file appears to be missing. The file owner may need to re-upload it.`,
            chunk_index: chunk.chunk_index
          }, 404);
        }
        
        return c.json({ 
          error: 'Failed to stream file chunk',
          message: errorMessage,
          chunk_index: chunk.chunk_index
        }, 500);
      }
    }

    const totalLength = chunkBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of chunkBuffers) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    return new Response(combined.buffer, {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Length': combined.length.toString(),
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error) {
    console.error('Stream share error:', error);
    return c.json({ error: 'Failed to stream shared file' }, 500);
  }
});

/**
 * DELETE /api/share/:share_id
 * Revoke share link
 */
app.delete('/:share_id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const share_id = c.req.param('share_id');

    // Verify share belongs to user
    const share = await c.env.DB.prepare(
      'SELECT share_id FROM shares WHERE share_id = ? AND user_id = ?'
    ).bind(share_id, user.user_id).first();

    if (!share) {
      return c.json({ error: 'Share not found' }, 404);
    }

    // Deactivate share
    await c.env.DB.prepare(`
      UPDATE shares SET is_active = 0 WHERE share_id = ?
    `).bind(share_id).run();

    return c.json({ success: true, message: 'Share link revoked' });
  } catch (error) {
    console.error('Revoke share error:', error);
    return c.json({ error: 'Failed to revoke share link' }, 500);
  }
});

export default app;
