/**
 * Project Management Routes
 * CRUD operations for projects (JWT authenticated)
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

app.use('*', authMiddleware);

/**
 * POST /api/projects/create
 */
app.post('/create', async (c) => {
  try {
    const user = c.get('user');
    const { project_name, description } = await c.req.json();

    if (!project_name || !project_name.trim()) {
      return c.json({ error: 'project_name is required' }, 400);
    }

    const name = project_name.trim();
    const now = Math.floor(Date.now() / 1000);
    const project_id = `proj_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
    const folder_id = `folder_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    // Check duplicate name
    const existing = await c.env.DB.prepare(
      'SELECT project_id FROM projects WHERE user_id = ? AND project_name = ? AND is_active = 1'
    ).bind(user.user_id, name).first();

    if (existing) {
      return c.json({ error: 'A project with this name already exists' }, 409);
    }

    // Auto-create a folder for the project
    const folder_path = `/Projects/${name}`;
    await c.env.DB.prepare(`
      INSERT INTO folders (folder_id, user_id, folder_name, parent_folder_id, folder_path, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?)
    `).bind(folder_id, user.user_id, `📦 ${name}`, folder_path, now, now).run();

    // Create project
    await c.env.DB.prepare(`
      INSERT INTO projects (project_id, user_id, project_name, description, folder_id, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).bind(project_id, user.user_id, name, description || '', folder_id, now, now).run();

    return c.json({
      project_id,
      project_name: name,
      description: description || '',
      folder_id,
      created_at: now,
    });
  } catch (error) {
    console.error('Create project error:', error);
    return c.json({ error: 'Failed to create project', message: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

/**
 * GET /api/projects/list
 */
app.get('/list', async (c) => {
  try {
    const user = c.get('user');

    const projects = await c.env.DB.prepare(`
      SELECT p.project_id, p.project_name, p.description, p.folder_id, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM api_keys ak WHERE ak.project_id = p.project_id AND ak.is_active = 1) as key_count,
        (SELECT COUNT(*) FROM files f WHERE f.folder_id = p.folder_id AND f.is_deleted = 0) as file_count,
        (SELECT COALESCE(SUM(f.file_size), 0) FROM files f WHERE f.folder_id = p.folder_id AND f.is_deleted = 0) as total_size
      FROM projects p
      WHERE p.user_id = ? AND p.is_active = 1
      ORDER BY p.created_at DESC
    `).bind(user.user_id).all();

    return c.json({ projects: projects.results });
  } catch (error) {
    console.error('List projects error:', error);
    return c.json({ error: 'Failed to list projects' }, 500);
  }
});

/**
 * GET /api/projects/:project_id
 */
app.get('/:project_id', async (c) => {
  try {
    const user = c.get('user');
    const project_id = c.req.param('project_id');

    const project = await c.env.DB.prepare(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM api_keys ak WHERE ak.project_id = p.project_id AND ak.is_active = 1) as key_count,
        (SELECT COUNT(*) FROM files f WHERE f.folder_id = p.folder_id AND f.is_deleted = 0) as file_count,
        (SELECT COALESCE(SUM(f.file_size), 0) FROM files f WHERE f.folder_id = p.folder_id AND f.is_deleted = 0) as total_size
      FROM projects p
      WHERE p.project_id = ? AND p.user_id = ? AND p.is_active = 1
    `).bind(project_id, user.user_id).first();

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    return c.json({ project });
  } catch (error) {
    console.error('Get project error:', error);
    return c.json({ error: 'Failed to get project' }, 500);
  }
});

/**
 * PUT /api/projects/:project_id
 */
app.put('/:project_id', async (c) => {
  try {
    const user = c.get('user');
    const project_id = c.req.param('project_id');
    const { project_name, description } = await c.req.json();

    const existing = await c.env.DB.prepare(
      'SELECT project_id FROM projects WHERE project_id = ? AND user_id = ? AND is_active = 1'
    ).bind(project_id, user.user_id).first();

    if (!existing) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const now = Math.floor(Date.now() / 1000);
    const updates: string[] = [];
    const values: any[] = [];

    if (project_name) { updates.push('project_name = ?'); values.push(project_name.trim()); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    updates.push('updated_at = ?'); values.push(now);
    values.push(project_id);

    await c.env.DB.prepare(
      `UPDATE projects SET ${updates.join(', ')} WHERE project_id = ?`
    ).bind(...values).run();

    return c.json({ success: true });
  } catch (error) {
    console.error('Update project error:', error);
    return c.json({ error: 'Failed to update project' }, 500);
  }
});

/**
 * DELETE /api/projects/:project_id
 */
app.delete('/:project_id', async (c) => {
  try {
    const user = c.get('user');
    const project_id = c.req.param('project_id');

    const project = await c.env.DB.prepare(
      'SELECT project_id FROM projects WHERE project_id = ? AND user_id = ? AND is_active = 1'
    ).bind(project_id, user.user_id).first();

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // Soft-delete project and deactivate all its API keys
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE projects SET is_active = 0, updated_at = ? WHERE project_id = ?').bind(now, project_id),
      c.env.DB.prepare('UPDATE api_keys SET is_active = 0 WHERE project_id = ?').bind(project_id),
    ]);

    return c.json({ success: true });
  } catch (error) {
    console.error('Delete project error:', error);
    return c.json({ error: 'Failed to delete project' }, 500);
  }
});

export default app;
