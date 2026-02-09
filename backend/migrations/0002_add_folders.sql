-- Migration 2: Add folders support

-- Folders table
CREATE TABLE IF NOT EXISTS folders (
    folder_id TEXT PRIMARY KEY,  -- UUID
    user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    folder_name TEXT NOT NULL,
    parent_folder_id TEXT REFERENCES folders(folder_id) ON DELETE CASCADE,
    folder_path TEXT NOT NULL,  -- Full path like "/Documents/Projects"
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, parent_folder_id, folder_name)
);

CREATE INDEX idx_folders_user_id ON folders(user_id);
CREATE INDEX idx_folders_parent ON folders(parent_folder_id);
CREATE INDEX idx_folders_path ON folders(user_id, folder_path);

-- Add folder_id to files table
ALTER TABLE files ADD COLUMN folder_id TEXT REFERENCES folders(folder_id) ON DELETE SET NULL;

CREATE INDEX idx_files_folder_id ON files(folder_id);
