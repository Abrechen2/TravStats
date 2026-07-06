-- App preferences backup/sync — mobile app settings blob (units, formats, …)
--
-- Hand-written additive migration (see CLAUDE.md). Both are nullable column
-- adds, idempotent via IF NOT EXISTS — safe to re-apply. PAT / device
-- identity are NOT stored here; this is just an opaque per-user JSON blob the
-- mobile client backs up to and restores from.

-- Opaque JSON preferences blob owned by the mobile client.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "app_prefs" JSONB;

-- Last-write timestamp for last-write-wins sync.
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "app_prefs_updated_at" TIMESTAMP(3);
