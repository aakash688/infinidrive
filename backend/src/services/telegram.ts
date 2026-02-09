/**
 * Telegram Bot API Service
 * Handles all interactions with Telegram Bot API
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';
const CHUNK_SIZE_LIMIT = 20 * 1024 * 1024; // 20MB

// Rate limiting: track last call time per bot
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 3000; // 3 seconds between calls per bot

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: {
    id: number;
    type: string;
  };
  document?: {
    file_id: string;
    file_unique_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
  video?: {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    duration: number;
    mime_type?: string;
    file_size?: number;
  };
  photo?: Array<{
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
  }>;
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

/**
 * Enforce rate limiting for bot API calls
 */
async function rateLimit(botToken: string): Promise<void> {
  const lastCall = rateLimitMap.get(botToken) || 0;
  const now = Date.now();
  const timeSinceLastCall = now - lastCall;

  if (timeSinceLastCall < RATE_LIMIT_MS) {
    const waitTime = RATE_LIMIT_MS - timeSinceLastCall;
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  rateLimitMap.set(botToken, Date.now());
}

/**
 * Make a request to Telegram Bot API
 */
async function telegramRequest<T>(
  botToken: string,
  method: string,
  body?: FormData | Record<string, any>
): Promise<T> {
  await rateLimit(botToken);

  const url = `${TELEGRAM_API_BASE}${botToken}/${method}`;
  
  let response: Response;
  
  if (body instanceof FormData) {
    response = await fetch(url, {
      method: 'POST',
      body,
    });
  } else if (body) {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } else {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API error: ${response.status} - ${errorText}`);
  }

  const data: TelegramResponse<T> = await response.json();

  if (!data.ok) {
    throw new Error(`Telegram API error: ${data.error_code} - ${data.description}`);
  }

  return data.result as T;
}

/**
 * Validate a bot token by calling getMe
 */
export async function validateBotToken(token: string): Promise<TelegramUser> {
  try {
    const user = await telegramRequest<TelegramUser>(token, 'getMe');
    
    if (user.is_bot) {
      return user;
    } else {
      throw new Error('Token does not belong to a bot');
    }
  } catch (error) {
    throw new Error(`Invalid bot token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Send a document (file chunk) to a Telegram channel
 */
export async function sendDocument(
  botToken: string,
  channelId: string,
  fileBuffer: ArrayBuffer | Uint8Array,
  fileName: string = 'chunk.bin'
): Promise<{ message_id: number; file_id: string }> {
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: 'application/octet-stream' });
  formData.append('chat_id', channelId);
  formData.append('document', blob, fileName);

  const message = await telegramRequest<TelegramMessage>(botToken, 'sendDocument', formData);

  if (!message.document) {
    throw new Error('No document in Telegram response');
  }

  return {
    message_id: message.message_id,
    file_id: message.document.file_id,
  };
}

/**
 * Get file information from Telegram
 */
export async function getFile(botToken: string, fileId: string): Promise<TelegramFile> {
  try {
    return await telegramRequest<TelegramFile>(botToken, 'getFile', {
      file_id: fileId,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[getFile] Failed to get file with file_id ${fileId.substring(0, 30)}...:`, errorMsg);
    throw error;
  }
}

/**
 * Get file from message in channel (fallback method)
 */
export async function getFileFromMessage(
  botToken: string,
  channelId: string,
  messageId: number
): Promise<TelegramFile | null> {
  try {
    const message = await telegramRequest<TelegramMessage>(botToken, 'getChat', {
      chat_id: channelId,
    });
    
    // Try to forward/get the message
    // Note: This is a workaround - we'll use forwardMessage to get the file
    const forwarded = await telegramRequest<TelegramMessage>(botToken, 'forwardMessage', {
      chat_id: channelId,
      from_chat_id: channelId,
      message_id: messageId,
    });
    
    if (forwarded.document) {
      return await getFile(botToken, forwarded.document.file_id);
    }
    
    return null;
  } catch (error) {
    console.error(`[getFileFromMessage] Failed to get file from message ${messageId}:`, error);
    return null;
  }
}

/**
 * Construct download URL for a file
 * Note: Telegram file download URL format is: https://api.telegram.org/file/bot<token>/<file_path>
 */
export function getFileUrl(botToken: string, filePath: string): string {
  // Telegram file download endpoint is different from bot API endpoint
  return `https://api.telegram.org/file/bot${botToken}/${filePath}`;
}

/**
 * Download file from Telegram
 */
export async function downloadFile(botToken: string, fileId: string): Promise<ArrayBuffer> {
  try {
    console.log(`[downloadFile] Attempting to download file_id: ${fileId.substring(0, 30)}...`);
    
    const file = await getFile(botToken, fileId);
    
    console.log(`[downloadFile] getFile response:`, {
      file_id: file.file_id,
      file_path: file.file_path,
      file_size: file.file_size
    });
    
    if (!file.file_path) {
      throw new Error('File path not available from Telegram');
    }

    const url = getFileUrl(botToken, file.file_path);
    console.log(`[downloadFile] Downloading from URL: ${url.substring(0, 80)}...`);
    
    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error(`[downloadFile] HTTP error ${response.status}:`, errorText);
      throw new Error(`Failed to download file from Telegram: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    console.log(`[downloadFile] Successfully downloaded ${arrayBuffer.byteLength} bytes`);
    return arrayBuffer;
  } catch (error) {
    console.error(`[downloadFile] Error for file_id ${fileId.substring(0, 30)}...:`, error);
    
    // If it's already a formatted error, re-throw it
    if (error instanceof Error && error.message.includes('Telegram API error')) {
      // Check if it's a 404 or file not found error
      if (error.message.includes('404') || error.message.includes('file not found') || error.message.includes('Bad Request') || error.message.includes('400')) {
        throw new Error(`Telegram file not found. The file may have been deleted or the file_id is invalid. File ID: ${fileId.substring(0, 20)}...`);
      }
      throw error;
    }
    // Wrap other errors
    throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get or create a storage channel for a bot
 * Note: Telegram Bot API doesn't allow bots to create channels directly
 * This function attempts alternative methods or returns null for manual setup
 */
export async function createChannel(
  botToken: string,
  channelName: string
): Promise<{ id: number; username?: string }> {
  // Telegram Bot API limitation: Bots cannot create channels or supergroups
  // They can only be added to existing channels by users
  // 
  // Alternative approaches:
  // 1. Use bot's own chat (not suitable for file storage)
  // 2. Guide user to create channel manually (current approach)
  // 3. Use a helper bot that creates channels (requires additional setup)
  
  // For now, we'll return null and let the user configure manually
  // In the future, we could:
  // - Provide a helper bot that creates channels
  // - Use Telegram's deep linking to guide users
  // - Detect channel ID when bot is added to a channel
  
  throw new Error('Bots cannot create channels via API. Please create a channel manually and add the bot as admin.');
}

/**
 * Get bot information
 */
export async function getBotInfo(botToken: string): Promise<{ id: number; username: string; first_name: string }> {
  const user = await validateBotToken(botToken);
  return {
    id: user.id,
    username: user.username || '',
    first_name: user.first_name,
  };
}

/**
 * Check if bot is healthy (can make API calls)
 */
export async function checkBotHealth(botToken: string): Promise<'healthy' | 'rate_limited' | 'banned' | 'unknown'> {
  try {
    await validateBotToken(botToken);
    return 'healthy';
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    if (errorMessage.includes('429') || errorMessage.includes('rate')) {
      return 'rate_limited';
    } else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
      return 'banned';
    } else {
      return 'unknown';
    }
  }
}
