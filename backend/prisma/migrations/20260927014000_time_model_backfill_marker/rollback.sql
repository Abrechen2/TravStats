-- Rollback for 20260927014000_time_model_backfill_marker (ADR 0002 phase 3b).
-- Schema only: drops the marker and the two ledger columns this migration
-- added. It does NOT undo the backfill's data — for that, run
-- undo-backfill.sql FIRST (it needs the ledger's rows to know which rows the
-- backfill wrote). Afterwards mark the migration rolled back:
--   npx prisma migrate resolve --rolled-back 20260927014000_time_model_backfill_marker

DROP INDEX IF EXISTS "time_migration_ledger_user_id_status_idx";
ALTER TABLE "time_migration_ledger" DROP COLUMN IF EXISTS "reason", DROP COLUMN IF EXISTS "user_id";
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "time_model_backfill_at";
