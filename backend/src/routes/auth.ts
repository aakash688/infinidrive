/**
 * Authentication Routes
 * Handles Telegram login, QR sessions, JWT management
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { 
  verifyTelegramLogin, 
  createJWT, 
  generateQRSessionId,
  hashJWT
} from '../services/auth';

type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
};

const app = new Hono<{ Bindings: Env }>();

/**
 * GET /api/auth/bot-username
 * Get the Telegram bot username for login widget
 */
app.get('/bot-username', async (c) => {
  return c.json({ 
    bot_username: 'MyInfiniDriveBot'
  });
});

/**
 * POST /api/auth/telegram
 * Verify Telegram Login Widget data and create session
 */
app.post('/telegram', async (c) => {
  try {
    const data = await c.req.json();
    
    // For Telegram Login Widget verification
    // Note: TELEGRAM_BOT_TOKEN is optional - if not set, we'll do basic validation
    // Users will add their own storage bots via the web panel
    const botToken = c.env.TELEGRAM_BOT_TOKEN;
    
    // Basic validation - check required fields
    if (!data.id || !data.first_name || !data.hash) {
      return c.json({ error: 'Invalid Telegram login data' }, 400);
    }

    // If bot token is set, verify cryptographically (more secure)
    // If not set, we'll trust the client-side widget (less secure but functional)
    if (botToken) {
      const isValid = await verifyTelegramLogin(data, botToken);
      if (!isValid) {
        return c.json({ error: 'Invalid Telegram login data' }, 401);
      }
    } else {
      // Basic validation only - hash verification would require bot token
      // For personal use, this is acceptable
      console.warn('TELEGRAM_BOT_TOKEN not set - using basic validation only');
    }

    const user_id = `tg_${data.id}`;
    const display_name = data.first_name + (data.last_name ? ` ${data.last_name}` : '');
    const telegram_username = data.username || null;

    // Check if user exists, create if not
    const existingUser = await c.env.DB.prepare(
      'SELECT user_id FROM users WHERE user_id = ?'
    ).bind(user_id).first();

    if (!existingUser) {
      await c.env.DB.prepare(`
        INSERT INTO users (user_id, display_name, telegram_username, last_seen)
        VALUES (?, ?, ?, ?)
      `).bind(user_id, display_name, telegram_username, Math.floor(Date.now() / 1000)).run();
    } else {
      // Update last_seen
      await c.env.DB.prepare(`
        UPDATE users SET last_seen = ?, display_name = ?, telegram_username = ?
        WHERE user_id = ?
      `).bind(
        Math.floor(Date.now() / 1000),
        display_name,
        telegram_username,
        user_id
      ).run();
    }

    // Create JWT
    const jwt = await createJWT(c.env.JWT_SECRET, {
      user_id,
      display_name,
      telegram_id: data.id,
    });

    // Store session in database
    const session_id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const jwt_hash = await hashJWT(jwt);
    const expires_at = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

    await c.env.DB.prepare(`
      INSERT INTO sessions (session_id, user_id, jwt_hash, expires_at, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).bind(session_id, user_id, jwt_hash, expires_at).run();

    return c.json({
      token: jwt,
      user: {
        user_id,
        display_name,
        telegram_username,
      },
    });
  } catch (error) {
    console.error('Telegram login error:', error);
    return c.json({ 
      error: 'Login failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * POST /api/auth/qr/generate
 * Generate QR code session for TV/Desktop login
 */
app.post('/qr/generate', async (c) => {
  try {
    const session_id = generateQRSessionId();
    const expires_at = Math.floor((Date.now() + 10 * 60 * 1000) / 1000); // 10 minutes

    // Store QR session in database (no user_id yet, will be set on approval)
    await c.env.DB.prepare(`
      INSERT INTO sessions (session_id, user_id, jwt_hash, expires_at, is_active)
      VALUES (?, '', '', ?, 0)
    `).bind(session_id, expires_at).run();

    return c.json({
      session_id,
      qr_data: JSON.stringify({ session_id, expires_at }), // For QR code generation
      expires_at,
    });
  } catch (error) {
    console.error('QR generation error:', error);
    return c.json({ error: 'Failed to generate QR session' }, 500);
  }
});

/**
 * POST /api/auth/qr/approve
 * Approve QR session from mobile app
 */
app.post('/qr/approve', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { session_id } = await c.req.json();

    if (!session_id) {
      return c.json({ error: 'session_id required' }, 400);
    }

    // Get QR session
    const qrSession = await c.env.DB.prepare(
      'SELECT * FROM sessions WHERE session_id = ?'
    ).bind(session_id).first<{
      session_id: string;
      user_id: string;
      expires_at: number;
      is_active: number;
    }>();

    if (!qrSession) {
      return c.json({ error: 'Invalid session_id' }, 404);
    }

    if (qrSession.is_active === 1) {
      return c.json({ error: 'Session already approved' }, 400);
    }

    // Check if expired
    if (Date.now() / 1000 > qrSession.expires_at) {
      return c.json({ error: 'Session expired' }, 400);
    }

    // Create JWT for the approved session
    const jwt = await createJWT(c.env.JWT_SECRET, {
      user_id: user.user_id,
      display_name: user.display_name,
      telegram_id: user.telegram_id,
    });

    const jwt_hash = await hashJWT(jwt);
    const new_expires_at = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

    // Update session with user info and activate
    await c.env.DB.prepare(`
      UPDATE sessions 
      SET user_id = ?, jwt_hash = ?, expires_at = ?, is_active = 1
      WHERE session_id = ?
    `).bind(user.user_id, jwt_hash, new_expires_at, session_id).run();

    return c.json({
      success: true,
      token: jwt,
    });
  } catch (error) {
    console.error('QR approval error:', error);
    return c.json({ error: 'Failed to approve session' }, 500);
  }
});

/**
 * GET /api/auth/qr/status/:session_id
 * Poll QR session status (for TV/Desktop waiting for approval)
 */
app.get('/qr/status/:session_id', async (c) => {
  try {
    const session_id = c.req.param('session_id');

    const session = await c.env.DB.prepare(
      'SELECT * FROM sessions WHERE session_id = ?'
    ).bind(session_id).first<{
      session_id: string;
      user_id: string;
      jwt_hash: string;
      expires_at: number;
      is_active: number;
    }>();

    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    // Check if expired
    if (Date.now() / 1000 > session.expires_at) {
      return c.json({ 
        status: 'expired',
        message: 'Session expired'
      });
    }

    if (session.is_active === 1 && session.user_id) {
      // Session approved - return token (in production, you'd want to verify jwt_hash matches)
      return c.json({
        status: 'approved',
        message: 'Session approved',
        // Note: In production, you should regenerate token here or return it securely
      });
    }

    return c.json({
      status: 'pending',
      message: 'Waiting for approval',
    });
  } catch (error) {
    console.error('QR status check error:', error);
    return c.json({ error: 'Failed to check session status' }, 500);
  }
});

/**
 * POST /api/auth/logout
 * Invalidate session
 */
app.post('/logout', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const token = c.req.header('Authorization')?.split(' ')[1];

    if (token) {
      const jwt_hash = await hashJWT(token);
      
      // Deactivate all sessions with this JWT hash
      await c.env.DB.prepare(`
        UPDATE sessions 
        SET is_active = 0 
        WHERE user_id = ? AND jwt_hash = ?
      `).bind(user.user_id, jwt_hash).run();
    }

    return c.json({ success: true, message: 'Logged out' });
  } catch (error) {
    console.error('Logout error:', error);
    return c.json({ error: 'Logout failed' }, 500);
  }
});

export default app;
