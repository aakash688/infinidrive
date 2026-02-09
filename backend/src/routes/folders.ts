/**
 * Folder Management Routes
 * Create, list, update, delete folders
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
 * POST /api/folders/create
 * Create a new folder
 */
app.post('/create', async (c) => {
  try {
    const user = c.get('user');
    const { folder_name, parent_folder_id } = await c.req.json();

    if (!folder_name || folder_name.trim().length === 0) {
      return c.json({ error: 'folder_name is required' }, 400);
    }

    // Validate folder name (no special characters)
    if (!/^[a-zA-Z0-9_\s-]+$/.test(folder_name.trim())) {
      return c.json({ error: 'Folder name contains invalid characters. Use only letters, numbers, spaces, hyphens, and underscores.' }, 400);
    }

    // Check if folder already exists in the same parent
    const existing = await c.env.DB.prepare(`
      SELECT folder_id FROM folders 
      WHERE user_id = ? AND parent_folder_id = ? AND folder_name = ?
    `).bind(
      user.user_id,
      parent_folder_id || null,
      folder_name.trim()
    ).first();

    if (existing) {
      return c.json({ error: 'Folder already exists' }, 409);
    }

    // Build folder path
    let folder_path = '';
    if (parent_folder_id) {
      const parent = await c.env.DB.prepare(`
        SELECT folder_path FROM folders WHERE folder_id = ? AND user_id = ?
      `).bind(parent_folder_id, user.user_id).first<{ folder_path: string }>();

      if (!parent) {
        return c.json({ error: 'Parent folder not found' }, 404);
      }

      folder_path = `${parent.folder_path}/${folder_name.trim()}`;
    } else {
      folder_path = `/${folder_name.trim()}`;
    }

    const folder_id = `folder_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const now = Math.floor(Date.now() / 1000);

    await c.env.DB.prepare(`
      INSERT INTO folders (
        folder_id, user_id, folder_name, parent_folder_id, folder_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      folder_id,
      user.user_id,
      folder_name.trim(),
      parent_folder_id || null,
      folder_path,
      now,
      now
    ).run();

    return c.json({
      folder_id,
      folder_name: folder_name.trim(),
      parent_folder_id: parent_folder_id || null,
      folder_path,
      created_at: now,
    });
  } catch (error) {
    console.error('Create folder error:', error);
    return c.json({ 
      error: 'Failed to create folder',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /api/folders/list
 * List all folders for the user
 */
app.get('/list', async (c) => {
  try {
    const user = c.get('user');
    const parent_folder_id = c.req.query('parent_folder_id');

    let query: string;
    let params: any[];

    if (parent_folder_id && parent_folder_id.trim() !== '') {
      query = 'SELECT folder_id, folder_name, parent_folder_id, folder_path, created_at, updated_at FROM folders WHERE user_id = ? AND parent_folder_id = ? ORDER BY folder_name ASC';
      params = [user.user_id, parent_folder_id];
    } else {
      query = 'SELECT folder_id, folder_name, parent_folder_id, folder_path, created_at, updated_at FROM folders WHERE user_id = ? AND parent_folder_id IS NULL ORDER BY folder_name ASC';
      params = [user.user_id];
    }

    const folders = await c.env.DB.prepare(query).bind(...params).all<{
      folder_id: string;
      folder_name: string;
      parent_folder_id: string | null;
      folder_path: string;
      created_at: number;
      updated_at: number;
    }>();

    return c.json({
      folders: folders.results,
      total: folders.results.length,
    });
  } catch (error) {
    console.error('List folders error:', error);
    return c.json({ error: 'Failed to list folders' }, 500);
  }
});

/**
 * GET /api/folders/tree
 * Get folder tree structure
 */
app.get('/tree', async (c) => {
  try {
    const user = c.get('user');

    const allFolders = await c.env.DB.prepare(`
      SELECT folder_id, folder_name, parent_folder_id, folder_path, created_at, updated_at
      FROM folders
      WHERE user_id = ?
      ORDER BY folder_path ASC
    `).bind(user.user_id).all<{
      folder_id: string;
      folder_name: string;
      parent_folder_id: string | null;
      folder_path: string;
      created_at: number;
      updated_at: number;
    }>();

    // Build tree structure
    const folderMap = new Map<string, any>();
    const rootFolders: any[] = [];

    // First pass: create all folder objects
    for (const folder of allFolders.results) {
      folderMap.set(folder.folder_id, {
        ...folder,
        children: [],
      });
    }

    // Second pass: build tree
    for (const folder of allFolders.results) {
      const folderObj = folderMap.get(folder.folder_id)!;
      if (folder.parent_folder_id) {
        const parent = folderMap.get(folder.parent_folder_id);
        if (parent) {
          parent.children.push(folderObj);
        } else {
          rootFolders.push(folderObj);
        }
      } else {
        rootFolders.push(folderObj);
      }
    }

    return c.json({
      tree: rootFolders,
    });
  } catch (error) {
    console.error('Get folder tree error:', error);
    return c.json({ error: 'Failed to get folder tree' }, 500);
  }
});

/**
 * PUT /api/folders/:folder_id
 * Update folder (rename or move)
 */
app.put('/:folder_id', async (c) => {
  try {
    const user = c.get('user');
    const folder_id = c.req.param('folder_id');
    const { folder_name, parent_folder_id } = await c.req.json();

    // Verify folder belongs to user
    const folder = await c.env.DB.prepare(`
      SELECT folder_id, folder_path FROM folders WHERE folder_id = ? AND user_id = ?
    `).bind(folder_id, user.user_id).first<{
      folder_id: string;
      folder_path: string;
    }>();

    if (!folder) {
      return c.json({ error: 'Folder not found' }, 404);
    }

    const now = Math.floor(Date.now() / 1000);
    let new_path = folder.folder_path;

    // If renaming
    if (folder_name && folder_name.trim() !== '') {
      if (!/^[a-zA-Z0-9_\s-]+$/.test(folder_name.trim())) {
        return c.json({ error: 'Folder name contains invalid characters' }, 400);
      }

      // Build new path
      const pathParts = folder.folder_path.split('/');
      pathParts[pathParts.length - 1] = folder_name.trim();
      new_path = pathParts.join('/');

      await c.env.DB.prepare(`
        UPDATE folders 
        SET folder_name = ?, folder_path = ?, updated_at = ?
        WHERE folder_id = ?
      `).bind(folder_name.trim(), new_path, now, folder_id).run();

      // Update all child folder paths
      await c.env.DB.prepare(`
        UPDATE folders 
        SET folder_path = REPLACE(folder_path, ?, ?)
        WHERE user_id = ? AND folder_path LIKE ?
      `).bind(
        folder.folder_path,
        new_path,
        user.user_id,
        `${folder.folder_path}%`
      ).run();
    }

    // If moving
    if (parent_folder_id !== undefined) {
      if (parent_folder_id === folder_id) {
        return c.json({ error: 'Cannot move folder into itself' }, 400);
      }

      // Check for circular reference
      if (parent_folder_id) {
        const parentPath = await c.env.DB.prepare(`
          SELECT folder_path FROM folders WHERE folder_id = ? AND user_id = ?
        `).bind(parent_folder_id, user.user_id).first<{ folder_path: string }>();

        if (!parentPath) {
          return c.json({ error: 'Parent folder not found' }, 404);
        }

        if (folder.folder_path.startsWith(parentPath.folder_path)) {
          return c.json({ error: 'Cannot move folder into its own subfolder' }, 400);
        }

        new_path = `${parentPath.folder_path}/${folder.folder_name}`;
      } else {
        new_path = `/${folder.folder_name}`;
      }

      await c.env.DB.prepare(`
        UPDATE folders 
        SET parent_folder_id = ?, folder_path = ?, updated_at = ?
        WHERE folder_id = ?
      `).bind(parent_folder_id || null, new_path, now, folder_id).run();

      // Update all child folder paths
      await c.env.DB.prepare(`
        UPDATE folders 
        SET folder_path = REPLACE(folder_path, ?, ?)
        WHERE user_id = ? AND folder_path LIKE ?
      `).bind(
        folder.folder_path,
        new_path,
        user.user_id,
        `${folder.folder_path}%`
      ).run();
    }

    return c.json({
      success: true,
      folder_id,
      folder_path: new_path,
    });
  } catch (error) {
    console.error('Update folder error:', error);
    return c.json({ error: 'Failed to update folder' }, 500);
  }
});

/**
 * DELETE /api/folders/:folder_id
 * Delete a folder (and optionally move files to parent or delete them)
 */
app.delete('/:folder_id', async (c) => {
  try {
    const user = c.get('user');
    const folder_id = c.req.param('folder_id');
    const { move_files_to_parent = false } = await c.req.json();

    // Verify folder belongs to user
    const folder = await c.env.DB.prepare(`
      SELECT folder_id, parent_folder_id FROM folders WHERE folder_id = ? AND user_id = ?
    `).bind(folder_id, user.user_id).first<{
      folder_id: string;
      parent_folder_id: string | null;
    }>();

    if (!folder) {
      return c.json({ error: 'Folder not found' }, 404);
    }

    // Check if folder has subfolders
    const subfolders = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM folders WHERE parent_folder_id = ?
    `).bind(folder_id).first<{ count: number }>();

    if (subfolders && subfolders.count > 0) {
      return c.json({ 
        error: 'Cannot delete folder with subfolders. Please delete or move subfolders first.' 
      }, 400);
    }

    // Check if folder has files
    const files = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM files WHERE folder_id = ? AND is_deleted = 0
    `).bind(folder_id).first<{ count: number }>();

    if (files && files.count > 0) {
      if (move_files_to_parent) {
        // Move files to parent folder
        await c.env.DB.prepare(`
          UPDATE files SET folder_id = ? WHERE folder_id = ?
        `).bind(folder.parent_folder_id, folder_id).run();
      } else {
        return c.json({ 
          error: 'Folder contains files. Set move_files_to_parent=true to move files to parent folder, or delete files first.' 
        }, 400);
      }
    }

    // Delete folder
    await c.env.DB.prepare(`
      DELETE FROM folders WHERE folder_id = ?
    `).bind(folder_id).run();

    return c.json({
      success: true,
      message: 'Folder deleted successfully',
    });
  } catch (error) {
    console.error('Delete folder error:', error);
    return c.json({ error: 'Failed to delete folder' }, 500);
  }
});

export default app;
