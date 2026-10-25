-- Migration 0032: Add ip column to admin_activity for audit log IP tracking
ALTER TABLE admin_activity ADD COLUMN ip TEXT;
