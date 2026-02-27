/**
 * Telegram Webhook Handler
 * Listens for bot updates to:
 * 1. Auto-detect when bots are added to channels
 * 2. Capture files sent to bots or channels (auto-upload)
 */

import { Hono } from 'hono';

type Env = {
  DB: D1Database;
};

const app = new Hono<{ Bindings: Env }>();

// Helper: Extract file info from a Telegram message
function extractFileInfo(message: any): {
  file_id: string;
  file_unique_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  file_type: string; // 'document', 'photo', 'video', 'audio', 'voice', 'video_note', 'animation'
} | null {
  // Document (any file)
  if (message.document) {
    return {
      file_id: message.document.file_id,
      file_unique_id: message.document.file_unique_id,
      file_name: message.document.file_name || `document_${Date.now()}`,
      file_size: message.document.file_size || 0,
      mime_type: message.document.mime_type || 'application/octet-stream',
      file_type: 'document',
    };
  }

  // Photo (get the largest resolution)
  if (message.photo && message.photo.length > 0) {
    const photo = message.photo[message.photo.length - 1]; // Largest photo
    return {
      file_id: photo.file_id,
      file_unique_id: photo.file_unique_id,
      file_name: `photo_${Date.now()}.jpg`,
      file_size: photo.file_size || 0,
      mime_type: 'image/jpeg',
      file_type: 'photo',
    };
  }

  // Video
  if (message.video) {
    return {
      file_id: message.video.file_id,
      file_unique_id: message.video.file_unique_id,
      file_name: message.video.file_name || `video_${Date.now()}.mp4`,
      file_size: message.video.file_size || 0,
      mime_type: message.video.mime_type || 'video/mp4',
      file_type: 'video',
    };
  }

  // Audio
  if (message.audio) {
    return {
      file_id: message.audio.file_id,
      file_unique_id: message.audio.file_unique_id,
      file_name: message.audio.file_name || message.audio.title || `audio_${Date.now()}.mp3`,
      file_size: message.audio.file_size || 0,
      mime_type: message.audio.mime_type || 'audio/mpeg',
      file_type: 'audio',
    };
  }

  // Voice message
  if (message.voice) {
    return {
      file_id: message.voice.file_id,
      file_unique_id: message.voice.file_unique_id,
      file_name: `voice_${Date.now()}.ogg`,
      file_size: message.voice.file_size || 0,
      mime_type: message.voice.mime_type || 'audio/ogg',
      file_type: 'voice',
    };
  }

  // Video note (round video)
  if (message.video_note) {
    return {
      file_id: message.video_note.file_id,
      file_unique_id: message.video_note.file_unique_id,
      file_name: `video_note_${Date.now()}.mp4`,
      file_size: message.video_note.file_size || 0,
      mime_type: 'video/mp4',
      file_type: 'video_note',
    };
  }

  // Animation (GIF)
  if (message.animation) {
    return {
      file_id: message.animation.file_id,
      file_unique_id: message.animation.file_unique_id,
      file_name: message.animation.file_name || `animation_${Date.now()}.mp4`,
      file_size: message.animation.file_size || 0,
      mime_type: message.animation.mime_type || 'video/mp4',
      file_type: 'animation',
    };
  }

  // Sticker
  if (message.sticker) {
    const ext = message.sticker.is_animated ? 'tgs' : message.sticker.is_video ? 'webm' : 'webp';
    return {
      file_id: message.sticker.file_id,
      file_unique_id: message.sticker.file_unique_id,
      file_name: `sticker_${Date.now()}.${ext}`,
      file_size: message.sticker.file_size || 0,
      mime_type: `image/${ext === 'webp' ? 'webp' : ext === 'webm' ? 'video/webm' : 'application/x-tgsticker'}`,
      file_type: 'sticker',
    };
  }

  return null;
}

// Helper: Get auto-categorize folder name based on file type
function getCategoryFolder(fileType: string, mimeType: string): string {
  if (fileType === 'photo' || mimeType.startsWith('image/')) return 'Images';
  if (fileType === 'video' || fileType === 'video_note' || fileType === 'animation' || mimeType.startsWith('video/')) return 'Videos';
  if (fileType === 'audio' || fileType === 'voice' || mimeType.startsWith('audio/')) return 'Audio';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('word') || mimeType.includes('text/')) return 'Documents';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('7z') || mimeType.includes('tar') || mimeType.includes('gzip')) return 'Archives';
  return 'Other';
}

// Helper: Check if file type is allowed
function isFileTypeAllowed(fileType: string, mimeType: string, allowedTypes: string): boolean {
  if (allowedTypes === 'all') return true;
  
  const allowed = allowedTypes.split(',').map(t => t.trim().toLowerCase());
  
  if (allowed.includes('documents') && (fileType === 'document' || mimeType.startsWith('application/'))) return true;
  if (allowed.includes('photos') && (fileType === 'photo' || mimeType.startsWith('image/'))) return true;
  if (allowed.includes('videos') && (fileType === 'video' || fileType === 'video_note' || fileType === 'animation' || mimeType.startsWith('video/'))) return true;
  if (allowed.includes('audio') && (fileType === 'audio' || fileType === 'voice' || mimeType.startsWith('audio/'))) return true;
  
  return false;
}

/**
 * POST /api/webhook/:bot_id
 * Telegram webhook endpoint for a specific bot
 * Handles:
 * 1. Bot added to channel (auto-configure)
 * 2. Files sent to bot or channel (auto-upload)
 */
app.post('/:bot_id', async (c) => {
  try {
    const bot_id = c.req.param('bot_id');
    const update = await c.req.json();

    console.log(`[webhook] Received update for bot ${bot_id}:`, JSON.stringify(update).substring(0, 500));

    // Get bot info
    const bot = await c.env.DB.prepare(
      'SELECT bot_id, bot_token_enc, user_id, channel_id, telegram_bot_id FROM bots WHERE bot_id = ? AND is_active = 1'
    ).bind(bot_id).first<{
      bot_id: string;
      bot_token_enc: string;
      user_id: string;
      channel_id: string | null;
      telegram_bot_id: number;
    }>();

    if (!bot) {
      console.log(`[webhook] Bot ${bot_id} not found or inactive`);
      return c.json({ ok: true });
    }

    // ==========================================
    // HANDLE: Bot added to channel/group
    // ==========================================
    if (update.message?.new_chat_members) {
      const newMembers = update.message.new_chat_members;
      const chat = update.message.chat;

      const botWasAdded = newMembers.some(
        (member: any) => member.id === bot.telegram_bot_id && member.is_bot === true
      );

      if (botWasAdded && (chat.type === 'channel' || chat.type === 'supergroup' || chat.type === 'group')) {
        const channel_id = chat.id.toString();

        await c.env.DB.prepare(`
          UPDATE bots SET channel_id = ? WHERE bot_id = ?
        `).bind(channel_id, bot_id).run();

        try {
          await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chat.id,
              text: '✅ InfiniDrive: Channel configured automatically! Files sent here will be captured to your drive.',
            }),
          });
        } catch (err) {
          console.warn('Failed to send confirmation message:', err);
        }

        return c.json({ ok: true, configured: true, channel_id });
      }
    }

    // Handle chat_member updates (when bot is added/promoted)
    if (update.chat_member) {
      const chat = update.chat_member.chat;
      const newMember = update.chat_member.new_chat_member;

      if (newMember?.user?.id === bot.telegram_bot_id &&
          (newMember.status === 'administrator' || newMember.status === 'member') &&
          (chat.type === 'channel' || chat.type === 'supergroup' || chat.type === 'group')) {
        const channel_id = chat.id.toString();
        
        await c.env.DB.prepare(`
          UPDATE bots SET channel_id = ? WHERE bot_id = ?
        `).bind(channel_id, bot_id).run();

        try {
          await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chat.id,
              text: '✅ InfiniDrive: Channel configured automatically!',
            }),
          });
        } catch (err) {
          console.warn('Failed to send confirmation:', err);
        }

        return c.json({ ok: true, configured: true, channel_id });
      }
    }

    // ==========================================
    // HANDLE: File messages (auto-upload)
    // ==========================================
    // This handles both:
    // - message: files sent directly to the bot
    // - channel_post: files posted in a channel where the bot is admin
    const message = update.message || update.channel_post;
    
    if (message) {
      const fileInfo = extractFileInfo(message);
      
      if (fileInfo) {
        console.log(`[webhook] File detected:`, {
          file_name: fileInfo.file_name,
          file_type: fileInfo.file_type,
          file_size: fileInfo.file_size,
          chat_id: message.chat?.id,
          chat_type: message.chat?.type,
        });

        // Check if auto-upload is enabled for this bot
        const config = await c.env.DB.prepare(
          'SELECT * FROM webhook_configs WHERE bot_id = ? AND is_enabled = 1'
        ).bind(bot_id).first<{
          config_id: string;
          bot_id: string;
          user_id: string;
          is_enabled: number;
          target_folder_id: string | null;
          auto_categorize: number;
          capture_from_bot: number;
          capture_from_channel: number;
          allowed_types: string;
          max_file_size: number;
        }>();

        if (!config) {
          console.log(`[webhook] Auto-upload not enabled for bot ${bot_id}`);
          
          // If it's a direct message to the bot, inform the user
          if (message.chat?.type === 'private') {
            try {
              await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: message.chat.id,
                  text: '📁 Auto-upload is not enabled for this bot. Please enable it in InfiniDrive Settings → Bot Configuration → Auto-Upload.',
                  reply_to_message_id: message.message_id,
                }),
              });
            } catch (err) {
              console.warn('Failed to send info message:', err);
            }
          }
          
          return c.json({ ok: true });
        }

        // Check source (bot DM vs channel)
        const isFromBot = message.chat?.type === 'private';
        const isFromChannel = message.chat?.type === 'channel' || message.chat?.type === 'supergroup' || message.chat?.type === 'group';

        if (isFromBot && !config.capture_from_bot) {
          console.log(`[webhook] Capture from bot DM is disabled`);
          return c.json({ ok: true });
        }

        if (isFromChannel && !config.capture_from_channel) {
          console.log(`[webhook] Capture from channel is disabled`);
          return c.json({ ok: true });
        }

        // Check file type filter
        if (!isFileTypeAllowed(fileInfo.file_type, fileInfo.mime_type, config.allowed_types || 'all')) {
          console.log(`[webhook] File type ${fileInfo.file_type} (${fileInfo.mime_type}) not allowed`);

          // Log as skipped
          const log_id = `wlog_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
          await c.env.DB.prepare(`
            INSERT INTO webhook_logs (log_id, bot_id, user_id, telegram_file_id, sender_id, sender_username, sender_name, chat_id, chat_title, file_name, file_size, mime_type, caption, status, error_message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped', 'File type not allowed', ?)
          `).bind(
            log_id, bot_id, bot.user_id, fileInfo.file_id,
            message.from?.id || null, message.from?.username || null, message.from?.first_name || null,
            message.chat?.id?.toString() || null, message.chat?.title || null,
            fileInfo.file_name, fileInfo.file_size, fileInfo.mime_type,
            message.caption || null,
            Math.floor(Date.now() / 1000)
          ).run();

          return c.json({ ok: true });
        }

        // Check file size limit
        if (config.max_file_size > 0 && fileInfo.file_size > config.max_file_size) {
          console.log(`[webhook] File too large: ${fileInfo.file_size} > ${config.max_file_size}`);
          
          const log_id = `wlog_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
          await c.env.DB.prepare(`
            INSERT INTO webhook_logs (log_id, bot_id, user_id, telegram_file_id, sender_id, sender_username, sender_name, chat_id, chat_title, file_name, file_size, mime_type, caption, status, error_message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped', 'File exceeds size limit', ?)
          `).bind(
            log_id, bot_id, bot.user_id, fileInfo.file_id,
            message.from?.id || null, message.from?.username || null, message.from?.first_name || null,
            message.chat?.id?.toString() || null, message.chat?.title || null,
            fileInfo.file_name, fileInfo.file_size, fileInfo.mime_type,
            message.caption || null,
            Math.floor(Date.now() / 1000)
          ).run();

          return c.json({ ok: true });
        }

        // ==========================================
        // PROCESS THE FILE - Create file + chunk records
        // ==========================================
        try {
          // Determine target folder
          let target_folder_id = config.target_folder_id;
          let folder_path = '/';

          // Auto-categorize: create/find sub-folder by file type
          if (config.auto_categorize && target_folder_id) {
            const categoryName = getCategoryFolder(fileInfo.file_type, fileInfo.mime_type);
            
            // Get parent folder path
            const parentFolder = await c.env.DB.prepare(
              'SELECT folder_path FROM folders WHERE folder_id = ? AND user_id = ?'
            ).bind(target_folder_id, bot.user_id).first<{ folder_path: string }>();

            if (parentFolder) {
              folder_path = parentFolder.folder_path;
              
              // Check if category sub-folder exists
              let categoryFolder = await c.env.DB.prepare(
                'SELECT folder_id, folder_path FROM folders WHERE user_id = ? AND parent_folder_id = ? AND folder_name = ?'
              ).bind(bot.user_id, target_folder_id, categoryName).first<{ folder_id: string; folder_path: string }>();

              if (!categoryFolder) {
                // Create the category folder
                const new_folder_id = `folder_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
                const new_folder_path = `${parentFolder.folder_path}/${categoryName}`;
                const now = Math.floor(Date.now() / 1000);

                await c.env.DB.prepare(`
                  INSERT INTO folders (folder_id, user_id, folder_name, parent_folder_id, folder_path, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `).bind(new_folder_id, bot.user_id, categoryName, target_folder_id, new_folder_path, now, now).run();

                categoryFolder = { folder_id: new_folder_id, folder_path: new_folder_path };
                console.log(`[webhook] Created category folder: ${categoryName} (${new_folder_id})`);
              }

              target_folder_id = categoryFolder.folder_id;
              folder_path = categoryFolder.folder_path;
            }
          } else if (target_folder_id) {
            const folder = await c.env.DB.prepare(
              'SELECT folder_path FROM folders WHERE folder_id = ? AND user_id = ?'
            ).bind(target_folder_id, bot.user_id).first<{ folder_path: string }>();
            if (folder) {
              folder_path = folder.folder_path;
            }
          }

          // Create file record
          const file_id = `file_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
          const now = Math.floor(Date.now() / 1000);
          const file_path = folder_path === '/' ? `/${fileInfo.file_name}` : `${folder_path}/${fileInfo.file_name}`;

          // Source info (who sent it)
          const sourceInfo = JSON.stringify({
            sender_id: message.from?.id,
            sender_username: message.from?.username,
            sender_name: message.from?.first_name ? `${message.from.first_name}${message.from.last_name ? ' ' + message.from.last_name : ''}` : null,
            chat_id: message.chat?.id,
            chat_type: message.chat?.type,
            chat_title: message.chat?.title,
            caption: message.caption,
            message_id: message.message_id,
          });

          // Use caption as the file name if it's short enough and looks like a name
          let finalFileName = fileInfo.file_name;
          if (message.caption && message.caption.length < 100 && !message.caption.includes('\n')) {
            // If caption looks like a filename, use it
            if (message.caption.includes('.')) {
              finalFileName = message.caption;
            }
          }

          await c.env.DB.prepare(`
            INSERT INTO files (
              file_id, user_id, folder_id, file_name, file_path, file_size,
              mime_type, file_hash, chunk_count, is_encrypted, is_public,
              source, source_info, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 'webhook', ?, ?, ?)
          `).bind(
            file_id, bot.user_id, target_folder_id || null,
            finalFileName, file_path, fileInfo.file_size,
            fileInfo.mime_type, fileInfo.file_unique_id, // Use unique_id as hash
            sourceInfo, now, now
          ).run();

          // ==========================================
          // SEND IMMEDIATE ACKNOWLEDGMENT
          // ==========================================
          let statusMessageId: number | null = null;
          const replyChatId = message.chat?.id;
          const replyMessageId = message.message_id;
          
          if (replyChatId) {
            try {
              const sizeStr = fileInfo.file_size > 1024 * 1024
                ? `${(fileInfo.file_size / (1024 * 1024)).toFixed(1)} MB`
                : `${(fileInfo.file_size / 1024).toFixed(1)} KB`;

              const statusResponse = await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: replyChatId,
                  text: `📥 **File Received**\n\n📄 ${finalFileName}\n📦 ${sizeStr}\n\n⏳ Processing and uploading to InfiniDrive...\n\n_This may take a few minutes for large files._`,
                  reply_to_message_id: replyMessageId,
                  parse_mode: 'Markdown',
                }),
              });

              const statusResult: any = await statusResponse.json();
              if (statusResult.ok) {
                statusMessageId = statusResult.result.message_id;
              }
            } catch (statusError) {
              console.warn('[webhook] Failed to send status message:', statusError);
            }
          }

          // ==========================================
          // PROCESS FILE ASYNCHRONOUSLY (Background)
          // ==========================================
          const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB chunks
          const chunk_count = Math.ceil(fileInfo.file_size / CHUNK_SIZE);
          
          // Get storage channel (must be configured)
          const storageChannelId = bot.channel_id;
          if (!storageChannelId) {
            // Send error message
            if (replyChatId && statusMessageId) {
              try {
                await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/editMessageText`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: replyChatId,
                    message_id: statusMessageId,
                    text: `❌ **Upload Failed**\n\n📄 ${finalFileName}\n\n⚠️ Bot storage channel not configured. Please configure a channel in Settings.`,
                    parse_mode: 'Markdown',
                  }),
                });
              } catch (e) {}
            }
            throw new Error('Bot storage channel not configured. Please configure a channel in Settings.');
          }

          // Update file record with correct chunk count
          await c.env.DB.prepare(`
            UPDATE files SET chunk_count = ? WHERE file_id = ?
          `).bind(chunk_count, file_id).run();

          // Process in background using waitUntil
          const processPromise = (async () => {
            try {
              // Update status: Downloading
              if (replyChatId && statusMessageId) {
                try {
                  await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: replyChatId,
                      message_id: statusMessageId,
                      text: `📥 **Downloading from Telegram...**\n\n📄 ${finalFileName}\n📦 ${(fileInfo.file_size / (1024 * 1024)).toFixed(1)} MB\n\n⏳ Please wait...`,
                      parse_mode: 'Markdown',
                    }),
                  });
                } catch (e) {}
              }

              // Download file from Telegram
              console.log(`[webhook] Downloading file from Telegram: ${fileInfo.file_name} (${fileInfo.file_size} bytes)`);
              const { downloadFile, sendDocument } = await import('../services/telegram');
              
              const fileData = await downloadFile(bot.bot_token_enc, fileInfo.file_id);
              console.log(`[webhook] Downloaded ${fileData.byteLength} bytes from Telegram`);

              // Update status: Uploading
              if (replyChatId && statusMessageId) {
                try {
                  await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: replyChatId,
                      message_id: statusMessageId,
                      text: `⬆️ **Uploading to InfiniDrive...**\n\n📄 ${finalFileName}\n📦 ${(fileInfo.file_size / (1024 * 1024)).toFixed(1)} MB\n\n📊 Chunks: 0/${chunk_count}\n⏳ Please wait...`,
                      parse_mode: 'Markdown',
                    }),
                  });
                } catch (e) {}
              }

              // Split into chunks and upload to our storage channel
              const fileArray = new Uint8Array(fileData);
              const uploadedChunks: Array<{ chunk_index: number; message_id: number; file_id: string }> = [];

              for (let chunkIndex = 0; chunkIndex < chunk_count; chunkIndex++) {
                const start = chunkIndex * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, fileArray.length);
                const chunkData = fileArray.slice(start, end);

                // Upload chunk to our storage channel
                const chunkFileName = `chunk_${file_id}_${chunkIndex}.bin`;
                const uploadResult = await sendDocument(
                  bot.bot_token_enc,
                  storageChannelId,
                  chunkData.buffer,
                  chunkFileName
                );

                uploadedChunks.push({
                  chunk_index: chunkIndex,
                  message_id: uploadResult.message_id,
                  file_id: uploadResult.file_id,
                });

                // Calculate hash for chunk
                const chunkHash = `${fileInfo.file_unique_id}_${chunkIndex}`;

                // Save chunk record
                const chunk_id = `chunk_${file_id}_${chunkIndex}`;
                await c.env.DB.prepare(`
                  INSERT INTO chunks (
                    chunk_id, file_id, chunk_index, chunk_size, chunk_hash,
                    bot_id, telegram_message_id, telegram_file_id, channel_id, created_at
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(
                  chunk_id, file_id, chunkIndex, chunkData.length,
                  chunkHash, bot_id,
                  uploadResult.message_id, uploadResult.file_id,
                  storageChannelId, now
                ).run();

                console.log(`[webhook] Uploaded chunk ${chunkIndex + 1}/${chunk_count} (${chunkData.length} bytes)`);

                // Update progress every 5 chunks or on last chunk
                if ((chunkIndex + 1) % 5 === 0 || chunkIndex === chunk_count - 1) {
                  if (replyChatId && statusMessageId) {
                    const progress = Math.round(((chunkIndex + 1) / chunk_count) * 100);
                    try {
                      await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/editMessageText`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          chat_id: replyChatId,
                          message_id: statusMessageId,
                          text: `⬆️ **Uploading to InfiniDrive...**\n\n📄 ${finalFileName}\n📦 ${(fileInfo.file_size / (1024 * 1024)).toFixed(1)} MB\n\n📊 Progress: ${chunkIndex + 1}/${chunk_count} chunks (${progress}%)\n⏳ Please wait...`,
                          parse_mode: 'Markdown',
                        }),
                      });
                    } catch (e) {}
                  }
                }
              }

              console.log(`[webhook] Successfully uploaded all ${chunk_count} chunks to storage channel`);

              // Log success
              const log_id = `wlog_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
              await c.env.DB.prepare(`
                INSERT INTO webhook_logs (log_id, bot_id, user_id, file_id, telegram_file_id, sender_id, sender_username, sender_name, chat_id, chat_title, file_name, file_size, mime_type, caption, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'captured', ?)
              `).bind(
                log_id, bot_id, bot.user_id, file_id, fileInfo.file_id,
                message.from?.id || null, message.from?.username || null, message.from?.first_name || null,
                message.chat?.id?.toString() || null, message.chat?.title || null,
                finalFileName, fileInfo.file_size, fileInfo.mime_type,
                message.caption || null,
                Math.floor(Date.now() / 1000)
              ).run();

              // Send success message
              if (replyChatId && statusMessageId) {
                try {
                  const sizeStr = fileInfo.file_size > 1024 * 1024
                    ? `${(fileInfo.file_size / (1024 * 1024)).toFixed(1)} MB`
                    : `${(fileInfo.file_size / 1024).toFixed(1)} KB`;

                  await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: replyChatId,
                      message_id: statusMessageId,
                      text: `✅ **File Saved to InfiniDrive!**\n\n📄 ${finalFileName}\n📦 ${sizeStr}\n📁 ${folder_path === '/' ? 'Root' : folder_path}\n\n🎉 Upload complete! You can now access it in your File Manager.`,
                      parse_mode: 'Markdown',
                    }),
                  });
                } catch (e) {}
              }

            } catch (processError) {
              console.error(`[webhook] Background processing failed:`, processError);
              
              // Send error message
              if (replyChatId && statusMessageId) {
                try {
                  await fetch(`https://api.telegram.org/bot${bot.bot_token_enc}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: replyChatId,
                      message_id: statusMessageId,
                      text: `❌ **Upload Failed**\n\n📄 ${finalFileName}\n\n⚠️ ${processError instanceof Error ? processError.message : 'Unknown error'}\n\nPlease try again or contact support.`,
                      parse_mode: 'Markdown',
                    }),
                  });
                } catch (e) {}
              }

              // Log failure
              const log_id = `wlog_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
              await c.env.DB.prepare(`
                INSERT INTO webhook_logs (log_id, bot_id, user_id, file_id, telegram_file_id, sender_id, sender_username, sender_name, chat_id, chat_title, file_name, file_size, mime_type, caption, status, error_message, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)
              `).bind(
                log_id, bot_id, bot.user_id, file_id, fileInfo.file_id,
                message.from?.id || null, message.from?.username || null, message.from?.first_name || null,
                message.chat?.id?.toString() || null, message.chat?.title || null,
                finalFileName, fileInfo.file_size, fileInfo.mime_type,
                message.caption || null,
                processError instanceof Error ? processError.message : 'Unknown error',
                now
              ).run();

              // Delete file record on failure
              await c.env.DB.prepare(`DELETE FROM files WHERE file_id = ?`).bind(file_id).run();
            }
          })();

          // Use waitUntil to process in background (Cloudflare Workers)
          if (c.executionCtx && 'waitUntil' in c.executionCtx) {
            (c.executionCtx as any).waitUntil(processPromise);
          } else {
            // Fallback: process immediately (may timeout for large files)
            await processPromise;
          }

          console.log(`[webhook] File processing started:`, {
            file_id,
            file_name: finalFileName,
            file_size: fileInfo.file_size,
            folder: folder_path,
            chunk_count,
          });

          // Return immediately - processing happens in background
          return c.json({ ok: true, file_id, processing: true, message: 'File received, processing in background...' });

        } catch (processError) {
          console.error(`[webhook] Failed to process file:`, processError);

          // Log failure
          const log_id = `wlog_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
          await c.env.DB.prepare(`
            INSERT INTO webhook_logs (log_id, bot_id, user_id, telegram_file_id, sender_id, sender_username, sender_name, chat_id, chat_title, file_name, file_size, mime_type, caption, status, error_message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', ?, ?)
          `).bind(
            log_id, bot_id, bot.user_id, fileInfo.file_id,
            message.from?.id || null, message.from?.username || null, message.from?.first_name || null,
            message.chat?.id?.toString() || null, message.chat?.title || null,
            fileInfo.file_name, fileInfo.file_size, fileInfo.mime_type,
            message.caption || null,
            processError instanceof Error ? processError.message : 'Unknown error',
            Math.floor(Date.now() / 1000)
          ).run();

          // Don't fail the webhook - Telegram would retry
          return c.json({ ok: true });
        }
      }
    }

    return c.json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return c.json({ ok: true }); // Always return ok to Telegram
  }
});

/**
 * GET /api/webhook/:bot_id/logs
 * Get webhook auto-upload logs (requires auth - handled by parent router)
 */
app.get('/:bot_id/logs', async (c) => {
  try {
    const bot_id = c.req.param('bot_id');
    const limit = parseInt(c.req.query('limit') || '50');
    const offset = parseInt(c.req.query('offset') || '0');
    const status = c.req.query('status');

    let query = `
      SELECT * FROM webhook_logs
      WHERE bot_id = ?
    `;
    const params: any[] = [bot_id];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const logs = await c.env.DB.prepare(query).bind(...params).all();

    return c.json({
      logs: logs.results,
      total: logs.results.length,
    });
  } catch (error) {
    console.error('Get webhook logs error:', error);
    return c.json({ error: 'Failed to get webhook logs' }, 500);
  }
});

export default app;
