/**
 * Device Management Routes
 * List and update devices
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
 * GET /api/devices/list
 * List all user's devices
 */
app.get('/list', async (c) => {
  try {
    const user = c.get('user');

    const devices = await c.env.DB.prepare(`
      SELECT 
        device_id, device_name, device_type, platform_info,
        last_seen, created_at
      FROM devices
      WHERE user_id = ?
      ORDER BY last_seen DESC
    `).bind(user.user_id).all<{
      device_id: string;
      device_name: string;
      device_type: string;
      platform_info: string | null;
      last_seen: number;
      created_at: number;
    }>();

    return c.json({
      devices: devices.results.map(device => ({
        device_id: device.device_id,
        device_name: device.device_name,
        device_type: device.device_type,
        platform_info: device.platform_info,
        last_seen: device.last_seen,
        created_at: device.created_at,
      })),
    });
  } catch (error) {
    console.error('List devices error:', error);
    return c.json({ error: 'Failed to list devices' }, 500);
  }
});

/**
 * PUT /api/devices/:device_id
 * Update device name
 */
app.put('/:device_id', async (c) => {
  try {
    const user = c.get('user');
    const device_id = c.req.param('device_id');
    const { device_name } = await c.req.json();

    if (!device_name) {
      return c.json({ error: 'device_name required' }, 400);
    }

    // Verify device belongs to user
    const device = await c.env.DB.prepare(
      'SELECT device_id FROM devices WHERE device_id = ? AND user_id = ?'
    ).bind(device_id, user.user_id).first();

    if (!device) {
      return c.json({ error: 'Device not found' }, 404);
    }

    // Update device
    await c.env.DB.prepare(`
      UPDATE devices 
      SET device_name = ?, last_seen = ?
      WHERE device_id = ?
    `).bind(device_name, Math.floor(Date.now() / 1000), device_id).run();

    return c.json({ success: true, message: 'Device updated' });
  } catch (error) {
    console.error('Update device error:', error);
    return c.json({ error: 'Failed to update device' }, 500);
  }
});

/**
 * POST /api/devices/register
 * Register a new device (called on first login from a device)
 */
app.post('/register', async (c) => {
  try {
    const user = c.get('user');
    const { device_id, device_name, device_type, platform_info } = await c.req.json();

    if (!device_id || !device_name || !device_type) {
      return c.json({ error: 'device_id, device_name, and device_type required' }, 400);
    }

    // Check if device already exists
    const existing = await c.env.DB.prepare(
      'SELECT device_id FROM devices WHERE device_id = ?'
    ).bind(device_id).first();

    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      // Update last_seen
      await c.env.DB.prepare(`
        UPDATE devices 
        SET last_seen = ?, device_name = ?, platform_info = ?
        WHERE device_id = ?
      `).bind(now, device_name, platform_info || null, device_id).run();
    } else {
      // Create new device
      await c.env.DB.prepare(`
        INSERT INTO devices (
          device_id, user_id, device_name, device_type, platform_info,
          last_seen, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        device_id,
        user.user_id,
        device_name,
        device_type,
        platform_info || null,
        now,
        now
      ).run();
    }

    return c.json({
      success: true,
      device_id,
      message: 'Device registered',
    });
  } catch (error) {
    console.error('Register device error:', error);
    return c.json({ error: 'Failed to register device' }, 500);
  }
});

export default app;
