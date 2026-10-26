-- 0036_notify_system.sql: Built-in notification system, channel configuration, rules engine, and queue

CREATE TABLE IF NOT EXISTS sys_notify_channels (
  site_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (site_id, channel)
);

CREATE TABLE IF NOT EXISTS sys_notify_rules (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  event TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 10,
  enabled INTEGER NOT NULL DEFAULT 1,
  remark TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notify_rules_site_event ON sys_notify_rules(site_id, event, enabled);

CREATE TABLE IF NOT EXISTS sys_notify_actions (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient_type TEXT NOT NULL DEFAULT 'admin',
  recipient_target TEXT,
  template_title TEXT,
  template_body TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notify_actions_rule ON sys_notify_actions(site_id, rule_id, enabled);

CREATE TABLE IF NOT EXISTS sys_notify_queue (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  rule_id TEXT,
  action_id TEXT,
  event TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT,
  title TEXT,
  content TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notify_queue_site_status ON sys_notify_queue(site_id, status, next_attempt_at);

CREATE TABLE IF NOT EXISTS sys_inapp_notifications (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id TEXT,
  role TEXT,
  event TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  url TEXT,
  status TEXT NOT NULL DEFAULT 'unread',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_inapp_notif_site_user ON sys_inapp_notifications(site_id, user_id, status);
CREATE INDEX IF NOT EXISTS idx_inapp_notif_site_created ON sys_inapp_notifications(site_id, created_at);
