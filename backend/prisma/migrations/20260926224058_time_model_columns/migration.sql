-- ADR 0002 phase 2 + 3a: additive time-model columns, DDL only.
-- Every column is nullable and no legacy column is touched, so the phase-2
-- write paths can dual-write and rollback.sql is lossless. The phase-3b
-- backfill converts existing rows in TypeScript (shared/time), not here:
-- Postgres AT TIME ZONE resolves a repeated hour to the later occurrence and
-- moves gap times in silence (plan, "Refinement to ADR D7").

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "backup_zone" TEXT;

-- AlterTable
ALTER TABLE "cruise_stops" ADD COLUMN     "arrival_utc" TIMESTAMP(3),
ADD COLUMN     "departure_utc" TIMESTAMP(3),
ADD COLUMN     "stop_date" DATE,
ADD COLUMN     "stop_zone" TEXT,
ADD COLUMN     "time_precision" TEXT;

-- AlterTable
ALTER TABLE "cruises" ADD COLUMN     "end_day" DATE,
ADD COLUMN     "end_zone" TEXT,
ADD COLUMN     "start_day" DATE,
ADD COLUMN     "start_zone" TEXT;

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "arr_precision" TEXT,
ADD COLUMN     "arr_timezone" TEXT,
ADD COLUMN     "dep_precision" TEXT,
ADD COLUMN     "dep_timezone" TEXT;

-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "check_in_at" TIMESTAMP(3),
ADD COLUMN     "check_in_date" DATE,
ADD COLUMN     "check_out_at" TIMESTAMP(3),
ADD COLUMN     "check_out_date" DATE,
ADD COLUMN     "stay_zone" TEXT;

-- AlterTable
ALTER TABLE "place_visits" ADD COLUMN     "visited_at_utc" TIMESTAMP(3),
ADD COLUMN     "visited_precision" TEXT,
ADD COLUMN     "visited_zone" TEXT,
ADD COLUMN     "written_via" TEXT;

-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "arr_precision" TEXT,
ADD COLUMN     "dep_precision" TEXT;

-- AlterTable
ALTER TABLE "trip_journal_entries" ADD COLUMN     "day" DATE;

-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "end_utc" TIMESTAMP(3),
ADD COLUMN     "precision" TEXT,
ADD COLUMN     "start_utc" TIMESTAMP(3),
ADD COLUMN     "stop_zone" TEXT;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "end_day" DATE,
ADD COLUMN     "end_zone" TEXT,
ADD COLUMN     "start_day" DATE,
ADD COLUMN     "start_zone" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "birth_day" DATE,
ADD COLUMN     "birth_precision" TEXT;

-- CreateTable
CREATE TABLE "time_migration_ledger" (
    "id" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "column_name" TEXT NOT NULL,
    "legacy_value" TEXT,
    "new_value" TEXT,
    "zone" TEXT,
    "rule" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "time_migration_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_migration_ledger_table_name_row_id_idx" ON "time_migration_ledger"("table_name", "row_id");

-- CreateIndex
CREATE INDEX "time_migration_ledger_status_idx" ON "time_migration_ledger"("status");

-- CreateIndex
CREATE INDEX "place_visits_user_id_visited_at_utc_idx" ON "place_visits"("user_id", "visited_at_utc");
