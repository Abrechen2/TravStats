-- ADR 0002 phase 3b: the backfill's marker and two ledger columns, DDL only.
-- Additive and nullable, like time_model_columns: nothing existing is
-- rewritten, so rollback.sql is lossless. The backfill itself runs in
-- TypeScript at boot (services/timeMigration), never here.

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "time_model_backfill_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "time_migration_ledger" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "user_id" TEXT;

-- CreateIndex
CREATE INDEX "time_migration_ledger_user_id_status_idx" ON "time_migration_ledger"("user_id", "status");
