-- 0034_theme_files.sql: Theme files stored in D1 database for environments without R2

CREATE TABLE IF NOT EXISTS theme_files (
  id TEXT PRIMARY KEY,
  theme_name TEXT NOT NULL,
  theme_version TEXT NOT NULL DEFAULT '1.0.0',
  file_path TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content TEXT NOT NULL,
  is_binary INTEGER NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(theme_name, file_path)
);

CREATE INDEX IF NOT EXISTS idx_theme_files_lookup ON theme_files(theme_name, file_path);
