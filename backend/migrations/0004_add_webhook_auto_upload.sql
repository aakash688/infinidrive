-- Migration 4: Add webhook auto-upload support
-- Allows bots to capture files sent to them or to their channels automatically

-- Webhook configs table - per-bot auto-upload settings
CREATE TABLE IF NOT EXISTS webhook_configs (
    config_id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(bot_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    is_enabled INTEGER NOT NULL DEFAULT 0,
    target_folder_id TEXT REFERENCES folders(folder_id) ON DELETE SET NULL,
    auto_categorize INTEGER NOT NULL DEFAULT 0,  -- Auto-sort by file type into sub-folders
    capture_from_bot INTEGER NOT NULL DEFAULT 1,  -- Capture files sent directly to bot
    capture_from_channel INTEGER NOT NULL DEFAULT 1,  -- Capture files posted in channel
    allowed_types TEXT DEFAULT 'all',  -- 'all', 'documents', 'photos', 'videos', 'audio' (comma separated)
    max_file_size INTEGER DEFAULT 0,  -- 0 = no limit
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(bot_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_configs_bot ON webhook_configs(bot_id);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_user ON webhook_configs(user_id);

-- Auto-upload log - track files captured via webhook
CREATE TABLE IF NOT EXISTS webhook_logs (
    log_id TEXT PRIMARY KEY,
    bot_id TEXT NOT NULL REFERENCES bots(bot_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    file_id TEXT REFERENCES files(file_id) ON DELETE SET NULL,
    telegram_file_id TEXT,
    sender_id INTEGER,  -- Telegram user ID who sent the file
    sender_username TEXT,
    sender_name TEXT,
    chat_id TEXT,  -- Chat/channel where the file was sent
    chat_title TEXT,
    file_name TEXT,
    file_size INTEGER,
    mime_type TEXT,
    caption TEXT,  -- Message caption if any
    status TEXT NOT NULL DEFAULT 'captured',  -- captured, processed, failed, skipped
    error_message TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_bot ON webhook_logs(bot_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_user ON webhook_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at DESC);

-- Add source column to files table to track how file was uploaded
ALTER TABLE files ADD COLUMN source TEXT DEFAULT 'upload';  -- 'upload', 'webhook', 'api'
ALTER TABLE files ADD COLUMN source_info TEXT;  -- JSON with sender info for webhook files
