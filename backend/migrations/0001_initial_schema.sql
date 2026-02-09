-- Migration: Initial schema
-- This file is a copy of schema.sql for wrangler migrations

-- Users table
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    telegram_username TEXT,
    master_key_hash TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
    settings_json TEXT
);

CREATE INDEX idx_users_telegram_username ON users(telegram_username);

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
    device_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    device_type TEXT NOT NULL,
    platform_info TEXT,
    last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_devices_user_id ON devices(user_id);
CREATE INDEX idx_devices_user_type ON devices(user_id, device_type);

-- Bots table
CREATE TABLE IF NOT EXISTS bots (
    bot_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    bot_token_enc TEXT NOT NULL,
    bot_username TEXT,
    telegram_bot_id INTEGER,
    channel_id TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_health_check INTEGER,
    health_status TEXT DEFAULT 'unknown'
);

CREATE INDEX idx_bots_user_id ON bots(user_id);
CREATE INDEX idx_bots_active ON bots(user_id, is_active);

-- Files table
CREATE TABLE IF NOT EXISTS files (
    file_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    device_id TEXT REFERENCES devices(device_id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT,
    file_hash TEXT NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 1,
    is_encrypted INTEGER NOT NULL DEFAULT 1,
    is_public INTEGER NOT NULL DEFAULT 0,
    public_title TEXT,
    public_category TEXT,
    public_tags TEXT,
    forked_from_file TEXT REFERENCES files(file_id) ON DELETE SET NULL,
    forked_from_user TEXT REFERENCES users(user_id) ON DELETE SET NULL,
    view_count INTEGER NOT NULL DEFAULT 0,
    fork_count INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_device_id ON files(device_id);
CREATE INDEX idx_files_hash ON files(file_hash);
CREATE INDEX idx_files_public ON files(is_public, public_category);
CREATE INDEX idx_files_deleted ON files(user_id, is_deleted);
CREATE INDEX idx_files_created ON files(user_id, created_at DESC);

-- Chunks table
CREATE TABLE IF NOT EXISTS chunks (
    chunk_id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    chunk_hash TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots(bot_id) ON DELETE RESTRICT,
    telegram_message_id INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(file_id, chunk_index)
);

CREATE INDEX idx_chunks_file_id ON chunks(file_id);
CREATE INDEX idx_chunks_bot_id ON chunks(bot_id);
CREATE INDEX idx_chunks_hash ON chunks(chunk_hash);

-- Shares table
CREATE TABLE IF NOT EXISTS shares (
    share_id TEXT PRIMARY KEY,
    file_id TEXT NOT NULL REFERENCES files(file_id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    password_hash TEXT,
    expires_at INTEGER,
    max_downloads INTEGER,
    download_count INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_shares_file_id ON shares(file_id);
CREATE INDEX idx_shares_active ON shares(share_id, is_active);

-- Backup configs table
CREATE TABLE IF NOT EXISTS backup_configs (
    config_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    folder_path TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    wifi_only INTEGER NOT NULL DEFAULT 1,
    frequency TEXT NOT NULL DEFAULT 'daily',
    last_backup_at INTEGER,
    file_types TEXT DEFAULT 'all',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_backup_configs_user_device ON backup_configs(user_id, device_id);
CREATE INDEX idx_backup_configs_active ON backup_configs(user_id, device_id, is_active);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    device_id TEXT REFERENCES devices(device_id) ON DELETE SET NULL,
    jwt_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_active ON sessions(session_id, is_active, expires_at);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
