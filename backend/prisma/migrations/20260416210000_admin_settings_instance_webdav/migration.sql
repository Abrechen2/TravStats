-- Move instance configuration and WebDAV settings from ENV to DB so the app
-- is fully configurable via the admin UI after a minimal Docker-only install.
--
-- New columns (with sensible defaults so existing rows need no backfill):
--   instance_name / max_users / allow_registration / frontend_url
--   webdav_sync_enabled / webdav_url / webdav_username
--   webdav_password_encrypted (AES-GCM via encryptApiKey)
--   webdav_backup_path
--
-- Existing ENV variables (INSTANCE_NAME, MAX_USERS, ALLOW_REGISTRATION,
-- FRONTEND_URL, WEBDAV_*) remain read as a fallback by the settings service
-- for the lifetime of v1.x — deployments that still set them keep working.

ALTER TABLE "admin_settings"
  ADD COLUMN "instance_name"             TEXT,
  ADD COLUMN "max_users"                 INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "allow_registration"        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "frontend_url"              TEXT,
  ADD COLUMN "webdav_sync_enabled"       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "webdav_url"                TEXT,
  ADD COLUMN "webdav_username"           TEXT,
  ADD COLUMN "webdav_password_encrypted" TEXT,
  ADD COLUMN "webdav_backup_path"        TEXT NOT NULL DEFAULT '/TravStats/backups/';
