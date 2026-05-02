-- Schema-drift reconciliation: earlier schema.prisma edits never got their own
-- migration, so `prisma migrate deploy` on a fresh DB ends up in a different
-- state than a long-lived DB. This migration closes the gap. All operations
-- are guarded with IF EXISTS / NOT EXISTS + explicit backfills so it's safe
-- on both a pristine dev DB and a drifted long-lived prod DB.

-- DropIndex (safe: idempotent; the unique constraint was removed from the
-- Prisma schema earlier without a matching drop migration).
DROP INDEX IF EXISTS "airports_iata_key";
DROP INDEX IF EXISTS "airports_icao_key";

-- AlterTable: bookings.updated_at — schema has @updatedAt without @default,
-- Prisma manages the column via client; DB-level default is legacy. Dropping
-- a non-existent default is a no-op, so unguarded.
ALTER TABLE "bookings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable: flights.has_live_tracking — schema is `Boolean @default(false)`
-- (non-null). Any rows with NULL must be backfilled BEFORE the NOT NULL
-- constraint is applied, otherwise the ALTER fails.
UPDATE "flights" SET "has_live_tracking" = false WHERE "has_live_tracking" IS NULL;
ALTER TABLE "flights" ALTER COLUMN "has_live_tracking" SET NOT NULL;

-- AlterTable: parse_training_logs.missing_fields — schema uses Prisma default
-- `String[] @default([])`; Prisma-managed at client level. Drop DB default.
ALTER TABLE "parse_training_logs" ALTER COLUMN "missing_fields" DROP DEFAULT;

-- AlterTable: user_settings.historical_enrichment_* — three columns with
-- Prisma defaults + non-null in schema. Backfill legacy NULLs before the
-- NOT NULL constraint.
UPDATE "user_settings"
  SET "historical_enrichment_enabled" = false
  WHERE "historical_enrichment_enabled" IS NULL;
UPDATE "user_settings"
  SET "historical_enrichment_min_confidence" = 60
  WHERE "historical_enrichment_min_confidence" IS NULL;
UPDATE "user_settings"
  SET "historical_enrichment_max_per_day" = 50
  WHERE "historical_enrichment_max_per_day" IS NULL;
ALTER TABLE "user_settings"
  ALTER COLUMN "historical_enrichment_enabled" SET NOT NULL,
  ALTER COLUMN "historical_enrichment_min_confidence" SET NOT NULL,
  ALTER COLUMN "historical_enrichment_max_per_day" SET NOT NULL;

-- AddForeignKey: pending_flight_updates — FKs declared in schema but missing
-- on long-lived DBs. DO-block guards against duplicate add on prod if the
-- constraint was manually added historically.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_flight_updates_flight_id_fkey'
  ) THEN
    ALTER TABLE "pending_flight_updates"
      ADD CONSTRAINT "pending_flight_updates_flight_id_fkey"
      FOREIGN KEY ("flight_id") REFERENCES "flights"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_flight_updates_user_id_fkey'
  ) THEN
    ALTER TABLE "pending_flight_updates"
      ADD CONSTRAINT "pending_flight_updates_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pending_update_statistics_user_id_fkey'
  ) THEN
    ALTER TABLE "pending_update_statistics"
      ADD CONSTRAINT "pending_update_statistics_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
