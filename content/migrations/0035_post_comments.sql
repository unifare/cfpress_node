-- 0035_post_comments.sql: Built-in article and page comments with tenant isolation

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  parent_id TEXT,
  author_member_id TEXT,
  author_name TEXT NOT NULL,
  author_email TEXT,
  author_url TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ip_hash TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_site_post_status ON comments(site_id, post_id, status);
CREATE INDEX IF NOT EXISTS idx_comments_site_status ON comments(site_id, status);
CREATE INDEX IF NOT EXISTS idx_comments_site_parent ON comments(site_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_site_member ON comments(site_id, author_member_id);
