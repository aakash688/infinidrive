/**
 * Bot Management Routes
 * Add, remove, list, and health-check bots
 */

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { validateBotToken, getBotInfo, checkBotHealth } from '../services/telegram';
import { hashJWT } from '../services/auth';

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

// All routes require authentication
app.use('*', authMiddleware);

/**
 * POST /api/bots/add
 * Add a new bot token
 */
app.post('/add', async (c) => {
  try {
    const user = c.get('user');
    const { bot_token } = await c.req.json();

    if (!bot_token) {
      return c.json({ error: 'bot_token required' }, 400);
    }

    // Validate bot token
    const botInfo = await validateBotToken(bot_token);
    
    // Check if bot already exists for this user (including inactive ones)
    const existing = await c.env.DB.prepare(
      'SELECT bot_id, is_active FROM bots WHERE user_id = ? AND telegram_bot_id = ?'
    ).bind(user.user_id, botInfo.id).first<{ bot_id: string; is_active: number }>();

    if (existing) {
      // If bot exists but is inactive, reactivate it instead of erroring
      if (existing.is_active === 0) {
        const now = Math.floor(Date.now() / 1000);
        
        // Try to auto-create channel if it doesn't exist
        let channel_id: string | null = null;
        const currentBot = await c.env.DB.prepare(
          'SELECT channel_id, bot_token_enc FROM bots WHERE bot_id = ?'
        ).bind(existing.bot_id).first<{ channel_id: string | null; bot_token_enc: string }>();
        
        if (!currentBot?.channel_id) {
          try {
            const { createChannel } = await import('../services/telegram');
            const channelName = `InfiniDrive_${botInfo.username || botInfo.id}_${Date.now()}`;
            const channel = await createChannel(bot_token, channelName);
            channel_id = channel.id.toString();
            console.log(`Auto-created storage group for reactivated bot: ${channel_id}`);
          } catch (error) {
            console.warn('Failed to auto-create storage group for reactivated bot:', error);
          }
        } else {
          channel_id = currentBot.channel_id;
        }
        
        // Reactivate the bot
        await c.env.DB.prepare(`
          UPDATE bots 
          SET is_active = 1, 
              bot_token_enc = ?,
              bot_username = ?,
              health_status = 'healthy',
              last_health_check = ?,
              channel_id = COALESCE(?, channel_id)
          WHERE bot_id = ?
        `).bind(
          bot_token, // Update token in case it changed
          botInfo.username || '',
          now,
          channel_id,
          existing.bot_id
        ).run();
        
        return c.json({
          bot_id: existing.bot_id,
          bot_username: botInfo.username,
          telegram_bot_id: botInfo.id,
          channel_id,
          message: channel_id 
            ? 'Bot reactivated successfully! Storage group configured.' 
            : 'Bot reactivated successfully! Please configure a channel manually.',
          reactivated: true,
        });
      } else {
        // Bot is already active
        return c.json({ error: 'Bot already added' }, 400);
      }
    }

    // Encrypt bot token (in production, use proper encryption with user's master key)
    // For now, we'll store it as-is (NOT SECURE - should encrypt in production)
    const bot_token_enc = bot_token; // TODO: Encrypt with user's master key

    const bot_id = `bot_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const now = Math.floor(Date.now() / 1000);

    // Set up webhook for this bot to auto-detect channel addition
    let channel_id: string | null = null;
    
    try {
      // Set webhook to detect when bot is added to a channel
      // Use the deployed worker URL (you may want to set this as an env var)
      const baseUrl = c.req.url.includes('localhost') 
        ? 'http://localhost:8787'
        : 'https://infinidrive-backend.infinidrive.workers.dev';
      const webhookUrl = `${baseUrl}/api/webhook/${bot_id}`;
      
      const webhookResponse = await fetch(`https://api.telegram.org/bot${bot_token}/setWebhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: webhookUrl,
          allowed_updates: ['message', 'channel_post', 'chat_member'],
        }),
      });
      
      const webhookResult = await webhookResponse.json();
      if (webhookResult.ok) {
        console.log(`✅ Webhook set for bot ${botInfo.username}: ${webhookUrl}`);
      } else {
        console.warn(`⚠️ Failed to set webhook: ${webhookResult.description}`);
      }
    } catch (error) {
      console.warn('Failed to set webhook (will use polling fallback):', error);
    }

    // Insert bot
    await c.env.DB.prepare(`
      INSERT INTO bots (
        bot_id, user_id, bot_token_enc, bot_username, telegram_bot_id,
        channel_id, is_active, created_at, health_status
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'healthy')
    `).bind(
      bot_id,
      user.user_id,
      bot_token_enc,
      botInfo.username || '',
      botInfo.id,
      channel_id,
      now
    ).run();

    return c.json({
      bot_id,
      bot_username: botInfo.username,
      telegram_bot_id: botInfo.id,
      channel_id,
      webhook_url: `${c.req.url.split('/api')[0]}/api/webhook/${bot_id}`,
      message: 'Bot added successfully! Now create a channel, add this bot as admin, and it will configure automatically.',
      setup_instructions: {
        step1: 'Create a private channel in Telegram',
        step2: `Add @${botInfo.username} as Administrator`,
        step3: 'The channel will be configured automatically when you add the bot!',
      },
      auto_configured: false, // Will be true once webhook detects channel
    });
  } catch (error) {
    console.error('Add bot error:', error);
    return c.json({ 
      error: 'Failed to add bot',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * POST /api/bots/:bot_id/health
 * Check bot health status
 */
app.post('/:bot_id/health', async (c) => {
  try {
    const user = c.get('user');
    const bot_id = c.req.param('bot_id');

    // Get bot token
    const bot = await c.env.DB.prepare(
      'SELECT bot_token_enc FROM bots WHERE bot_id = ? AND user_id = ?'
    ).bind(bot_id, user.user_id).first<{ bot_token_enc: string }>();

    if (!bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    // Check health
    const health = await checkBotHealth(bot.bot_token_enc);
    const now = Math.floor(Date.now() / 1000);

    // Update health status
    await c.env.DB.prepare(`
      UPDATE bots 
      SET health_status = ?, last_health_check = ?
      WHERE bot_id = ?
    `).bind(health, now, bot_id).run();

    return c.json({
      bot_id,
      health_status: health,
      last_health_check: now,
    });
  } catch (error) {
    console.error('Health check error:', error);
    return c.json({ error: 'Failed to check bot health' }, 500);
  }
});

/**
 * PUT /api/bots/:bot_id/channel
 * Set or update the channel ID for a bot
 */
app.put('/:bot_id/channel', async (c) => {
  try {
    const user = c.get('user');
    const bot_id = c.req.param('bot_id');
    const { channel_id } = await c.req.json();

    if (!channel_id) {
      return c.json({ error: 'channel_id required' }, 400);
    }

    // Verify bot belongs to user
    const bot = await c.env.DB.prepare(
      'SELECT bot_id FROM bots WHERE bot_id = ? AND user_id = ?'
    ).bind(bot_id, user.user_id).first();

    if (!bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    // Update channel_id
    await c.env.DB.prepare(`
      UPDATE bots SET channel_id = ? WHERE bot_id = ?
    `).bind(channel_id, bot_id).run();

    return c.json({
      success: true,
      message: 'Channel configured successfully',
      bot_id,
      channel_id,
    });
  } catch (error) {
    console.error('Set channel error:', error);
    return c.json({ error: 'Failed to set channel' }, 500);
  }
});

/**
 * DELETE /api/bots/:bot_id
 * Remove a bot
 */
app.delete('/:bot_id', async (c) => {
  try {
    const user = c.get('user');
    const bot_id = c.req.param('bot_id');

    // Verify bot belongs to user
    const bot = await c.env.DB.prepare(
      'SELECT bot_id FROM bots WHERE bot_id = ? AND user_id = ?'
    ).bind(bot_id, user.user_id).first();

    if (!bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    // Soft delete (set is_active = 0)
    const result = await c.env.DB.prepare(`
      UPDATE bots SET is_active = 0 WHERE bot_id = ?
    `).bind(bot_id).run();

    if (result.meta.changes === 0) {
      return c.json({ error: 'Bot not found or already removed' }, 404);
    }

    return c.json({ 
      success: true, 
      message: 'Bot removed successfully',
      bot_id 
    });
  } catch (error) {
    console.error('Remove bot error:', error);
    return c.json({ 
      error: 'Failed to remove bot',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * POST /api/bots/fix-webhooks
 * Re-register webhooks for ALL user's bots with correct allowed_updates
 * This fixes bots that were added before channel_post was included
 */
app.post('/fix-webhooks', async (c) => {
  try {
    const user = c.get('user');

    const bots = await c.env.DB.prepare(`
      SELECT bot_id, bot_token_enc, bot_username
      FROM bots
      WHERE user_id = ? AND is_active = 1
    `).bind(user.user_id).all<{
      bot_id: string;
      bot_token_enc: string;
      bot_username: string | null;
    }>();

    const baseUrl = c.req.url.includes('localhost')
      ? 'http://localhost:8787'
      : 'https://infinidrive-backend.infinidrive.workers.dev';

    const results: Array<{ bot_id: string; bot_username: string | null; success: boolean; error?: string }> = [];

    for (const bot of bots.results) {
      try {
        const webhookUrl = `${baseUrl}/api/webhook/${bot.bot_id}`;
        const response = await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ['message', 'channel_post', 'chat_member'],
          }),
        });
        const result: any = await response.json();
        results.push({
          bot_id: bot.bot_id,
          bot_username: bot.bot_username,
          success: result.ok === true,
          error: result.ok ? undefined : result.description,
        });
      } catch (err) {
        results.push({
          bot_id: bot.bot_id,
          bot_username: bot.bot_username,
          success: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return c.json({
      message: `Re-registered webhooks for ${results.filter(r => r.success).length}/${bots.results.length} bots`,
      results,
    });
  } catch (error) {
    console.error('Fix webhooks error:', error);
    return c.json({ error: 'Failed to fix webhooks' }, 500);
  }
});

/**
 * GET /api/bots/list
 * List all user's bots with health status and webhook config
 */
app.get('/list', async (c) => {
  try {
    const user = c.get('user');

    const bots = await c.env.DB.prepare(`
      SELECT 
        b.bot_id, b.bot_username, b.telegram_bot_id, b.channel_id,
        b.is_active, b.health_status, b.last_health_check, b.created_at,
        wc.is_enabled as webhook_enabled,
        wc.target_folder_id as webhook_folder_id,
        wc.auto_categorize as webhook_auto_categorize,
        wc.capture_from_bot as webhook_capture_bot,
        wc.capture_from_channel as webhook_capture_channel,
        wc.allowed_types as webhook_allowed_types,
        wc.max_file_size as webhook_max_file_size,
        f.folder_name as webhook_folder_name,
        f.folder_path as webhook_folder_path
      FROM bots b
      LEFT JOIN webhook_configs wc ON b.bot_id = wc.bot_id
      LEFT JOIN folders f ON wc.target_folder_id = f.folder_id
      WHERE b.user_id = ? AND b.is_active = 1
      ORDER BY b.created_at DESC
    `).bind(user.user_id).all();

    return c.json({
      bots: bots.results.map((bot: any) => ({
        bot_id: bot.bot_id,
        bot_username: bot.bot_username,
        telegram_bot_id: bot.telegram_bot_id,
        channel_id: bot.channel_id,
        is_active: bot.is_active === 1,
        health_status: bot.health_status,
        last_health_check: bot.last_health_check,
        created_at: bot.created_at,
        webhook_config: {
          enabled: bot.webhook_enabled === 1,
          target_folder_id: bot.webhook_folder_id,
          target_folder_name: bot.webhook_folder_name,
          target_folder_path: bot.webhook_folder_path,
          auto_categorize: bot.webhook_auto_categorize === 1,
          capture_from_bot: bot.webhook_capture_bot !== 0,  // Default true
          capture_from_channel: bot.webhook_capture_channel !== 0,  // Default true
          allowed_types: bot.webhook_allowed_types || 'all',
          max_file_size: bot.webhook_max_file_size || 0,
        },
      })),
    });
  } catch (error) {
    console.error('List bots error:', error);
    return c.json({ error: 'Failed to list bots' }, 500);
  }
});

/**
 * PUT /api/bots/:bot_id/webhook-config
 * Update auto-upload webhook configuration for a bot
 */
app.put('/:bot_id/webhook-config', async (c) => {
  try {
    const user = c.get('user');
    const bot_id = c.req.param('bot_id');
    const {
      is_enabled,
      target_folder_id,
      auto_categorize,
      capture_from_bot,
      capture_from_channel,
      allowed_types,
      max_file_size,
    } = await c.req.json();

    // Verify bot belongs to user
    const bot = await c.env.DB.prepare(
      'SELECT bot_id, bot_token_enc, channel_id FROM bots WHERE bot_id = ? AND user_id = ? AND is_active = 1'
    ).bind(bot_id, user.user_id).first<{ bot_id: string; bot_token_enc: string; channel_id: string | null }>();

    if (!bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    // Verify target folder exists if provided
    if (target_folder_id) {
      const folder = await c.env.DB.prepare(
        'SELECT folder_id FROM folders WHERE folder_id = ? AND user_id = ?'
      ).bind(target_folder_id, user.user_id).first();

      if (!folder) {
        return c.json({ error: 'Target folder not found' }, 404);
      }
    }

    const now = Math.floor(Date.now() / 1000);

    // Check if config exists
    const existing = await c.env.DB.prepare(
      'SELECT config_id FROM webhook_configs WHERE bot_id = ?'
    ).bind(bot_id).first();

    if (existing) {
      // Update
      await c.env.DB.prepare(`
        UPDATE webhook_configs SET
          is_enabled = ?,
          target_folder_id = ?,
          auto_categorize = ?,
          capture_from_bot = ?,
          capture_from_channel = ?,
          allowed_types = ?,
          max_file_size = ?,
          updated_at = ?
        WHERE bot_id = ?
      `).bind(
        is_enabled ? 1 : 0,
        target_folder_id || null,
        auto_categorize ? 1 : 0,
        capture_from_bot !== false ? 1 : 0,
        capture_from_channel !== false ? 1 : 0,
        allowed_types || 'all',
        max_file_size || 0,
        now,
        bot_id
      ).run();
    } else {
      // Create
      const config_id = `wc_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      await c.env.DB.prepare(`
        INSERT INTO webhook_configs (
          config_id, bot_id, user_id, is_enabled, target_folder_id,
          auto_categorize, capture_from_bot, capture_from_channel,
          allowed_types, max_file_size, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        config_id, bot_id, user.user_id,
        is_enabled ? 1 : 0,
        target_folder_id || null,
        auto_categorize ? 1 : 0,
        capture_from_bot !== false ? 1 : 0,
        capture_from_channel !== false ? 1 : 0,
        allowed_types || 'all',
        max_file_size || 0,
        now, now
      ).run();
    }

    // When enabling, ensure the webhook is properly set with correct allowed_updates
    if (is_enabled) {
      try {
        const baseUrl = c.req.url.includes('localhost')
          ? 'http://localhost:8787'
          : 'https://infinidrive-backend.infinidrive.workers.dev';
        const webhookUrl = `${baseUrl}/api/webhook/${bot_id}`;

        const webhookResponse = await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/setWebhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ['message', 'channel_post', 'chat_member'],
          }),
        });

        const webhookResult: any = await webhookResponse.json();
        if (webhookResult.ok) {
          console.log(`[webhook-config] Webhook updated for bot ${bot_id} with file capture`);
        } else {
          console.warn(`[webhook-config] Failed to update webhook:`, webhookResult.description);
        }
      } catch (err) {
        console.warn('[webhook-config] Failed to set webhook:', err);
      }
    }

    return c.json({
      success: true,
      message: is_enabled
        ? 'Auto-upload enabled! Files sent to this bot will be captured automatically.'
        : 'Auto-upload disabled.',
    });
  } catch (error) {
    console.error('Update webhook config error:', error);
    return c.json({ error: 'Failed to update webhook config' }, 500);
  }
});

/**
 * GET /api/bots/:bot_id/webhook-logs
 * Get auto-upload logs for a bot
 */
app.get('/:bot_id/webhook-logs', async (c) => {
  try {
    const user = c.get('user');
    const bot_id = c.req.param('bot_id');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const status = c.req.query('status');

    // Verify bot belongs to user
    const bot = await c.env.DB.prepare(
      'SELECT bot_id FROM bots WHERE bot_id = ? AND user_id = ?'
    ).bind(bot_id, user.user_id).first();

    if (!bot) {
      return c.json({ error: 'Bot not found' }, 404);
    }

    let query = `
      SELECT * FROM webhook_logs
      WHERE bot_id = ? AND user_id = ?
    `;
    const params: any[] = [bot_id, user.user_id];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = await c.env.DB.prepare(query).bind(...params).all();

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM webhook_logs WHERE bot_id = ? AND user_id = ?';
    const countParams: any[] = [bot_id, user.user_id];
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }
    const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ total: number }>();

    return c.json({
      logs: logs.results,
      total: countResult?.total || 0,
    });
  } catch (error) {
    console.error('Get webhook logs error:', error);
    return c.json({ error: 'Failed to get webhook logs' }, 500);
  }
});

export default app;
