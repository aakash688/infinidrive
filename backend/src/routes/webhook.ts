/**
 * Telegram Webhook Handler
 * Listens for bot updates to auto-detect when bots are added to channels
 */

import { Hono } from 'hono';

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/webhook/:bot_id
 * Telegram webhook endpoint for a specific bot
 * Auto-detects when bot is added to a channel and configures it
 */
app.post('/:bot_id', async (c) => {
  try {
    const bot_id = c.req.param('bot_id');
    const update = await c.req.json();

    // Check if this is a "bot added to chat" event
    if (update.message?.new_chat_members) {
      const newMembers = update.message.new_chat_members;
      const chat = update.message.chat;

      // Check if the bot itself was added
      const bot = await c.env.DB.prepare(
        'SELECT bot_id, bot_token_enc, user_id FROM bots WHERE bot_id = ? AND is_active = 1'
      ).bind(bot_id).first<{
        bot_id: string;
        bot_token_enc: string;
        user_id: string;
      }>();

      if (!bot) {
        return c.json({ ok: true }); // Bot not found, ignore
      }

      // Check if any new member is this bot
      const botInfo = await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/getMe`).then(r => r.json());
      const botUserId = botInfo.result?.id;

      const botWasAdded = newMembers.some((member: any) => member.id === botUserId && member.is_bot === true);

      if (botWasAdded && (chat.type === 'channel' || chat.type === 'supergroup')) {
        const channel_id = chat.id.toString();

        // Update bot with channel ID
        await c.env.DB.prepare(`
          UPDATE bots SET channel_id = ? WHERE bot_id = ?
        `).bind(channel_id, bot_id).run();

        // Send confirmation message to user
        try {
          await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chat.id,
              text: '✅ InfiniDrive: Channel configured automatically! You can now upload files.',
            }),
          });
        } catch (err) {
          console.warn('Failed to send confirmation message:', err);
        }

        return c.json({ ok: true, configured: true, channel_id });
      }
    }

    // Check chat_member updates (when bot is added or promoted)
    if (update.chat_member) {
      const chat = update.chat_member.chat;
      const newMember = update.chat_member.new_chat_member;
      
      // Check if this is our bot being added/promoted
      const bot = await c.env.DB.prepare(
        'SELECT bot_id, bot_token_enc FROM bots WHERE bot_id = ? AND is_active = 1'
      ).bind(bot_id).first<{
        bot_id: string;
        bot_token_enc: string;
      }>();

      if (bot) {
        const botInfo = await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/getMe`).then(r => r.json());
        const botUserId = botInfo.result?.id;

        if (newMember.user.id === botUserId && 
            (newMember.status === 'administrator' || newMember.status === 'member') &&
            (chat.type === 'channel' || chat.type === 'supergroup')) {
          const channel_id = chat.id.toString();
          
          await c.env.DB.prepare(`
            UPDATE bots SET channel_id = ? WHERE bot_id = ?
          `).bind(channel_id, bot_id).run();

          // Send confirmation message
          try {
            await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: chat.id,
                text: '✅ InfiniDrive: Channel configured automatically! You can now upload files.',
              }),
            });
          } catch (err) {
            console.warn('Failed to send confirmation message:', err);
          }

          return c.json({ ok: true, configured: true, channel_id });
        }
      }
    }

    return c.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return c.json({ ok: true }); // Always return ok to Telegram
  }
});

export default app;
