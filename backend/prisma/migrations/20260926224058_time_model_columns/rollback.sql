-- Rollback for 20260926224058_time_model_columns (ADR 0002 phase 3a).
-- Lossless: the migration only ADDED nullable columns and one table; every
-- legacy column is untouched, so dropping them returns the schema to what the
-- phase-1 code reads. Afterwards mark the migration rolled back:
--   npx prisma migrate resolve --rolled-back 20260926224058_time_model_columns
-- Only the dual-written copies (and the ledger, empty until phase 3b) are lost.

DROP INDEX IF EXISTS "place_visits_user_id_visited_at_utc_idx";
DROP TABLE IF EXISTS "time_migration_ledger";

ALTER TABLE "users" DROP COLUMN IF EXISTS "birth_day", DROP COLUMN IF EXISTS "birth_precision";
ALTER TABLE "trips" DROP COLUMN IF EXISTS "start_day", DROP COLUMN IF EXISTS "end_day",
  DROP COLUMN IF EXISTS "start_zone", DROP COLUMN IF EXISTS "end_zone";
ALTER TABLE "trip_stops" DROP COLUMN IF EXISTS "start_utc", DROP COLUMN IF EXISTS "end_utc",
  DROP COLUMN IF EXISTS "stop_zone", DROP COLUMN IF EXISTS "precision";
ALTER TABLE "trip_journal_entries" DROP COLUMN IF EXISTS "day";
ALTER TABLE "rail_journeys" DROP COLUMN IF EXISTS "dep_precision", DROP COLUMN IF EXISTS "arr_precision";
ALTER TABLE "place_visits" DROP COLUMN IF EXISTS "visited_at_utc", DROP COLUMN IF EXISTS "visited_zone",
  DROP COLUMN IF EXISTS "visited_precision", DROP COLUMN IF EXISTS "written_via";
ALTER TABLE "lodging_stays" DROP COLUMN IF EXISTS "check_in_date", DROP COLUMN IF EXISTS "check_out_date",
  DROP COLUMN IF EXISTS "check_in_at", DROP COLUMN IF EXISTS "check_out_at", DROP COLUMN IF EXISTS "stay_zone";
ALTER TABLE "flights" DROP COLUMN IF EXISTS "dep_timezone", DROP COLUMN IF EXISTS "arr_timezone",
  DROP COLUMN IF EXISTS "dep_precision", DROP COLUMN IF EXISTS "arr_precision";
ALTER TABLE "cruises" DROP COLUMN IF EXISTS "start_day", DROP COLUMN IF EXISTS "end_day",
  DROP COLUMN IF EXISTS "start_zone", DROP COLUMN IF EXISTS "end_zone";
ALTER TABLE "cruise_stops" DROP COLUMN IF EXISTS "arrival_utc", DROP COLUMN IF EXISTS "departure_utc",
  DROP COLUMN IF EXISTS "stop_zone", DROP COLUMN IF EXISTS "stop_date", DROP COLUMN IF EXISTS "time_precision";
ALTER TABLE "admin_settings" DROP COLUMN IF EXISTS "backup_zone";
