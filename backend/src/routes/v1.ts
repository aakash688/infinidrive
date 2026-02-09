/**
 * Public API v1 Routes
 * Authenticated via API keys - provides file and folder operations
 */

import { Hono } from 'hono';
import { apiKeyMiddleware, hasPermission } from '../middleware/apikey';
import { sendDocument, downloadFile, getFile } from '../services/telegram';

type Env = {
  DB: D1Database;
};

const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB

const app = new Hono<{ Bindings: Env }>();

// All v1 routes require API key
app.use('*', apiKeyMiddleware);

// ============================================
// FILE OPERATIONS
// ============================================

/**
 * POST /api/v1/files/upload
 * Single-request file upload (auto-chunked)
 * Body: { file_name, file_data (base64), mime_type?, folder_id? }
 */
app.post('/files/upload', async (c) => {
  try {
    const user = c.get('user');
    const project = c.get('project') as any;
    const apiKey = c.get('apiKey') as any;

    if (!hasPermission(apiKey.permissions, 'write')) {
      return c.json({ error: 'Write permission required' }, 403);
    }

    const { file_name, file_data, mime_type, folder_id } = await c.req.json();

    if (!file_name || !file_data) {
      return c.json({ error: 'file_name and file_data (base64) are required' }, 400);
    }

    // Decode base64
    const buffer = Uint8Array.from(atob(file_data), ch => ch.charCodeAt(0));
    const file_size = buffer.length;

    // Compute hash
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const file_hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    // Check duplicate
    const existing = await c.env.DB.prepare(
      'SELECT file_id, file_name FROM files WHERE user_id = ? AND file_hash = ? AND is_deleted = 0'
    ).bind(user.user_id, file_hash).first();

    if (existing) {
      return c.json({ file_id: existing.file_id, file_name: existing.file_name, duplicate: true, message: 'File already exists' }, 200);
    }

    // Get user's active bots
    const bots = await c.env.DB.prepare(`
      SELECT bot_id, bot_token_enc, channel_id
      FROM bots WHERE user_id = ? AND is_active = 1 AND health_status = 'healthy'
      ORDER BY last_health_check DESC
    `).bind(user.user_id).all<{ bot_id: string; bot_token_enc: string; channel_id: string | null }>();

    if (bots.results.length === 0) {
      return c.json({ error: 'No active bots configured. Set up a bot via the web panel first.' }, 400);
    }

    // Target folder: explicit folder_id > project's default folder
    const targetFolderId = folder_id || project.folder_id;

    // Verify folder if provided
    if (targetFolderId) {
      const folder = await c.env.DB.prepare(
        'SELECT folder_id FROM folders WHERE folder_id = ? AND user_id = ?'
      ).bind(targetFolderId, user.user_id).first();
      if (!folder) {
        return c.json({ error: 'Folder not found' }, 404);
      }
    }

    // Create file record
    const file_id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const chunk_count = Math.ceil(file_size / CHUNK_SIZE);
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(`
      INSERT INTO files (file_id, user_id, device_id, folder_id, file_name, file_path, file_size,
        mime_type, file_hash, chunk_count, is_public, created_at, updated_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(file_id, user.user_id, targetFolderId || null, file_name, `/${file_name}`, file_size,
      mime_type || 'application/octet-stream', file_hash, chunk_count, now, now
    ).run();

    // Upload chunks to Telegram
    for (let i = 0; i < chunk_count; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file_size);
      const chunkBuffer = buffer.slice(start, end);

      const selectedBot = bots.results[i % bots.results.length];
      if (!selectedBot.channel_id) {
        return c.json({ error: `Bot ${selectedBot.bot_id} has no channel configured` }, 400);
      }

      const result = await sendDocument(selectedBot.bot_token_enc, selectedBot.channel_id, chunkBuffer, `chunk_${i}.bin`);

      // Compute chunk hash
      const chunkHashBuffer = await crypto.subtle.digest('SHA-256', chunkBuffer);
      const chunk_hash = Array.from(new Uint8Array(chunkHashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      await c.env.DB.prepare(`
        INSERT INTO file_chunks (chunk_id, file_id, chunk_index, chunk_size, chunk_hash, bot_id, channel_id,
          telegram_file_id, telegram_message_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        `chunk_${file_id}_${i}`, file_id, i, chunkBuffer.length, chunk_hash,
        selectedBot.bot_id, selectedBot.channel_id, result.file_id, result.message_id, now
      ).run();
    }

    // Mark complete
    await c.env.DB.prepare("UPDATE files SET status = 'completed', updated_at = ? WHERE file_id = ?").bind(now, file_id).run();

    return c.json({
      file_id,
      file_name,
      file_size,
      mime_type: mime_type || 'application/octet-stream',
      chunk_count,
      folder_id: targetFolderId,
      status: 'completed',
      created_at: now,
    }, 201);
  } catch (error) {
    console.error('v1 upload error:', error);
    return c.json({ error: 'Upload failed', message: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

/**
 * POST /api/v1/files/upload/init - Chunked upload init
 */
app.post('/files/upload/init', async (c) => {
  try {
    const user = c.get('user');
    const project = c.get('project') as any;
    const apiKey = c.get('apiKey') as any;

    if (!hasPermission(apiKey.permissions, 'write')) {
      return c.json({ error: 'Write permission required' }, 403);
    }

    const { file_name, file_size, mime_type, file_hash, folder_id } = await c.req.json();

    if (!file_name || !file_size || !file_hash) {
      return c.json({ error: 'file_name, file_size, and file_hash required' }, 400);
    }

    const targetFolderId = folder_id || project.folder_id;
    const file_id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const chunk_count = Math.ceil(file_size / CHUNK_SIZE);
    const now = Math.floor(Date.now() / 1000);

    // Check duplicate
    const existing = await c.env.DB.prepare(
      'SELECT file_id FROM files WHERE user_id = ? AND file_hash = ? AND is_deleted = 0'
    ).bind(user.user_id, file_hash).first();
    if (existing) {
      return c.json({ file_id: existing.file_id, duplicate: true }, 200);
    }

    await c.env.DB.prepare(`
      INSERT INTO files (file_id, user_id, folder_id, file_name, file_path, file_size,
        mime_type, file_hash, chunk_count, is_public, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).bind(file_id, user.user_id, targetFolderId || null, file_name, `/${file_name}`,
      file_size, mime_type || 'application/octet-stream', file_hash, chunk_count, now, now
    ).run();

    return c.json({ file_id, chunk_count, chunk_size: CHUNK_SIZE });
  } catch (error) {
    console.error('v1 upload init error:', error);
    return c.json({ error: 'Failed to initialize upload' }, 500);
  }
});

/**
 * POST /api/v1/files/upload/chunk - Chunked upload
 */
app.post('/files/upload/chunk', async (c) => {
  try {
    const user = c.get('user');
    const { file_id, chunk_index, chunk_data, chunk_hash } = await c.req.json();

    if (!file_id || chunk_index === undefined || !chunk_data || !chunk_hash) {
      return c.json({ error: 'file_id, chunk_index, chunk_data, chunk_hash required' }, 400);
    }

    const file = await c.env.DB.prepare(
      'SELECT file_id, chunk_count FROM files WHERE file_id = ? AND user_id = ?'
    ).bind(file_id, user.user_id).first<{ file_id: string; chunk_count: number }>();

    if (!file) return c.json({ error: 'File not found' }, 404);

    const bots = await c.env.DB.prepare(`
      SELECT bot_id, bot_token_enc, channel_id FROM bots
      WHERE user_id = ? AND is_active = 1 AND health_status = 'healthy' ORDER BY last_health_check DESC
    `).bind(user.user_id).all<{ bot_id: string; bot_token_enc: string; channel_id: string | null }>();

    if (bots.results.length === 0) return c.json({ error: 'No active bots' }, 400);

    const selectedBot = bots.results[chunk_index % bots.results.length];
    if (!selectedBot.channel_id) return c.json({ error: 'Bot channel not configured' }, 400);

    const chunkBuffer = Uint8Array.from(atob(chunk_data), ch => ch.charCodeAt(0));
    const result = await sendDocument(selectedBot.bot_token_enc, selectedBot.channel_id, chunkBuffer, `chunk_${chunk_index}.bin`);
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(`
      INSERT INTO file_chunks (chunk_id, file_id, chunk_index, chunk_size, chunk_hash, bot_id, channel_id,
        telegram_file_id, telegram_message_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`chunk_${file_id}_${chunk_index}`, file_id, chunk_index, chunkBuffer.length, chunk_hash,
      selectedBot.bot_id, selectedBot.channel_id, result.file_id, result.message_id, now
    ).run();

    return c.json({ success: true, chunk_index });
  } catch (error) {
    console.error('v1 chunk upload error:', error);
    return c.json({ error: 'Chunk upload failed' }, 500);
  }
});

/**
 * POST /api/v1/files/upload/complete - Complete chunked upload
 */
app.post('/files/upload/complete', async (c) => {
  try {
    const user = c.get('user');
    const { file_id } = await c.req.json();

    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare("UPDATE files SET status = 'completed', updated_at = ? WHERE file_id = ? AND user_id = ?")
      .bind(now, file_id, user.user_id).run();

    return c.json({ success: true, file_id, status: 'completed' });
  } catch (error) {
    return c.json({ error: 'Failed to complete upload' }, 500);
  }
});

/**
 * GET /api/v1/files - List files in project
 */
app.get('/files', async (c) => {
  try {
    const user = c.get('user');
    const project = c.get('project') as any;
    const apiKey = c.get('apiKey') as any;

    if (!hasPermission(apiKey.permissions, 'read')) {
      return c.json({ error: 'Read permission required' }, 403);
    }

    const folder_id = c.req.query('folder_id') || project.folder_id;
    const limit = parseInt(c.req.query('limit') || '100');
    const offset = parseInt(c.req.query('offset') || '0');

    const files = await c.env.DB.prepare(`
      SELECT file_id, file_name, file_size, mime_type, file_hash, folder_id, created_at, updated_at, status
      FROM files WHERE user_id = ? AND folder_id = ? AND is_deleted = 0
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).bind(user.user_id, folder_id, limit, offset).all();

    return c.json({ files: files.results, folder_id, limit, offset });
  } catch (error) {
    return c.json({ error: 'Failed to list files' }, 500);
  }
});

/**
 * GET /api/v1/files/:file_id - Get file info
 */
app.get('/files/:file_id', async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');

    const file = await c.env.DB.prepare(
      'SELECT * FROM files WHERE file_id = ? AND user_id = ? AND is_deleted = 0'
    ).bind(file_id, user.user_id).first();

    if (!file) return c.json({ error: 'File not found' }, 404);
    return c.json({ file });
  } catch (error) {
    return c.json({ error: 'Failed to get file' }, 500);
  }
});

/**
 * GET /api/v1/files/:file_id/download - Download file
 */
app.get('/files/:file_id/download', async (c) => {
  try {
    const user = c.get('user');
    const file_id = c.req.param('file_id');

    const file = await c.env.DB.prepare(
      'SELECT file_id, file_name, file_size, mime_type FROM files WHERE file_id = ? AND user_id = ? AND is_deleted = 0'
    ).bind(file_id, user.user_id).first<{ file_id: string; file_name: string; file_size: number; mime_type: string }>();

    if (!file) return c.json({ error: 'File not found' }, 404);

    const chunks = await c.env.DB.prepare(`
      SELECT fc.chunk_index, fc.telegram_file_id, fc.bot_id, b.bot_token_enc
      FROM file_chunks fc
      JOIN bots b ON fc.bot_id = b.bot_id
      WHERE fc.file_id = ?
      ORDER BY fc.chunk_index ASC
    `).bind(file_id).all<{ chunk_index: number; telegram_file_id: string; bot_token_enc: string }>();

    if (chunks.results.length === 0) {
      return c.json({ error: 'No chunks found' }, 404);
    }

    // Download and concatenate chunks
    const parts: ArrayBuffer[] = [];
    for (const chunk of chunks.results) {
      const data = await downloadFile(chunk.bot_token_enc, chunk.telegram_file_id);
      parts.push(data);
    }

    const totalSize = parts.reduce((s, p) => s + p.byteLength, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const part of parts) {
      result.set(new Uint8Array(part), offset);
      offset += part.byteLength;
    }

    return new Response(result, {
      headers: {
        'Content-Type': file.mime_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.file_name}"`,
        'Content-Length': String(totalSize),
      },
    });
  } catch (error) {
    console.error('v1 download error:', error);
    return c.json({ error: 'Download failed' }, 500);
  }
});

/**
 * DELETE /api/v1/files/:file_id
 */
app.delete('/files/:file_id', async (c) => {
  try {
    const user = c.get('user');
    const apiKey = c.get('apiKey') as any;
    const file_id = c.req.param('file_id');

    if (!hasPermission(apiKey.permissions, 'write')) {
      return c.json({ error: 'Write permission required' }, 403);
    }

    const now = Math.floor(Date.now() / 1000);
    const result = await c.env.DB.prepare(
      'UPDATE files SET is_deleted = 1, updated_at = ? WHERE file_id = ? AND user_id = ?'
    ).bind(now, file_id, user.user_id).run();

    return c.json({ success: true, deleted: file_id });
  } catch (error) {
    return c.json({ error: 'Failed to delete file' }, 500);
  }
});

// ============================================
// FOLDER OPERATIONS
// ============================================

/**
 * POST /api/v1/folders - Create folder
 */
app.post('/folders', async (c) => {
  try {
    const user = c.get('user');
    const project = c.get('project') as any;
    const apiKey = c.get('apiKey') as any;

    if (!hasPermission(apiKey.permissions, 'write')) {
      return c.json({ error: 'Write permission required' }, 403);
    }

    const { folder_name, parent_folder_id } = await c.req.json();
    if (!folder_name?.trim()) return c.json({ error: 'folder_name required' }, 400);

    const parent = parent_folder_id || project.folder_id;
    const now = Math.floor(Date.now() / 1000);
    const folder_id = `folder_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // Get parent path
    let folder_path = `/${folder_name.trim()}`;
    if (parent) {
      const parentFolder = await c.env.DB.prepare(
        'SELECT folder_path FROM folders WHERE folder_id = ? AND user_id = ?'
      ).bind(parent, user.user_id).first<{ folder_path: string }>();
      if (parentFolder) {
        folder_path = `${parentFolder.folder_path}/${folder_name.trim()}`;
      }
    }

    await c.env.DB.prepare(`
      INSERT INTO folders (folder_id, user_id, folder_name, parent_folder_id, folder_path, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(folder_id, user.user_id, folder_name.trim(), parent || null, folder_path, now, now).run();

    return c.json({ folder_id, folder_name: folder_name.trim(), parent_folder_id: parent, folder_path, created_at: now }, 201);
  } catch (error) {
    console.error('v1 create folder error:', error);
    return c.json({ error: 'Failed to create folder', message: error instanceof Error ? error.message : 'Unknown' }, 500);
  }
});

/**
 * GET /api/v1/folders - List folders
 */
app.get('/folders', async (c) => {
  try {
    const user = c.get('user');
    const project = c.get('project') as any;
    const parent = c.req.query('parent_folder_id') || project.folder_id;

    const folders = parent
      ? await c.env.DB.prepare(
          'SELECT folder_id, folder_name, parent_folder_id, folder_path, created_at FROM folders WHERE user_id = ? AND parent_folder_id = ? ORDER BY folder_name ASC'
        ).bind(user.user_id, parent).all()
      : await c.env.DB.prepare(
          'SELECT folder_id, folder_name, parent_folder_id, folder_path, created_at FROM folders WHERE user_id = ? AND parent_folder_id IS NULL ORDER BY folder_name ASC'
        ).bind(user.user_id).all();

    return c.json({ folders: folders.results });
  } catch (error) {
    return c.json({ error: 'Failed to list folders' }, 500);
  }
});

/**
 * DELETE /api/v1/folders/:folder_id
 */
app.delete('/folders/:folder_id', async (c) => {
  try {
    const user = c.get('user');
    const apiKey = c.get('apiKey') as any;
    const folder_id = c.req.param('folder_id');

    if (!hasPermission(apiKey.permissions, 'write')) {
      return c.json({ error: 'Write permission required' }, 403);
    }

    // Move files to parent before deleting
    const folder = await c.env.DB.prepare(
      'SELECT folder_id, parent_folder_id FROM folders WHERE folder_id = ? AND user_id = ?'
    ).bind(folder_id, user.user_id).first<{ folder_id: string; parent_folder_id: string | null }>();

    if (!folder) return c.json({ error: 'Folder not found' }, 404);

    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE files SET folder_id = ? WHERE folder_id = ? AND user_id = ?')
        .bind(folder.parent_folder_id, folder_id, user.user_id),
      c.env.DB.prepare('DELETE FROM folders WHERE folder_id = ? AND user_id = ?')
        .bind(folder_id, user.user_id),
    ]);

    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: 'Failed to delete folder' }, 500);
  }
});

// ============================================
// PROJECT INFO
// ============================================

/**
 * GET /api/v1/project - Get current project info
 */
app.get('/project', async (c) => {
  const project = c.get('project') as any;
  return c.json({ project });
});

export default app;
