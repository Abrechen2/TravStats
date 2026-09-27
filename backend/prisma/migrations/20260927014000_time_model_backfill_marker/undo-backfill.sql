-- Undo the ADR 0002 phase-3b backfill's DATA (the migration beside this file
-- only added its marker; rollback.sql removes that).
--
-- The backfill wrote nothing but new time-model columns and the ledger, and
-- the ledger names every row it wrote. So undoing it is setting exactly those
-- rows' new columns back to NULL — rows the phase-2 write paths or a seed
-- filled (no ledger row) are left alone, and no legacy column is touched,
-- because none was ever written.
--
-- The ledger is KEPT (plan, phase 3b "Rollback"): it is the record of what
-- was read and decided. Consequence: the backfill skips every row the ledger
-- names, so to run it AGAIN after this undo, also run the last two statements
-- (commented out) — delete the ledger and clear the marker — and restart.
--
-- Run inside one transaction:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f undo-backfill.sql

UPDATE "flights" SET "dep_timezone" = NULL, "arr_timezone" = NULL,
       "dep_precision" = NULL, "arr_precision" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'flights');

UPDATE "rail_journeys" SET "dep_precision" = NULL, "arr_precision" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'rail_journeys');

UPDATE "place_visits" SET "visited_at_utc" = NULL, "visited_zone" = NULL,
       "visited_precision" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'place_visits');

UPDATE "cruise_stops" SET "arrival_utc" = NULL, "departure_utc" = NULL, "stop_zone" = NULL,
       "stop_date" = NULL, "time_precision" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'cruise_stops');

UPDATE "cruises" SET "start_day" = NULL, "end_day" = NULL, "start_zone" = NULL, "end_zone" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'cruises');

UPDATE "trip_stops" SET "start_utc" = NULL, "end_utc" = NULL, "stop_zone" = NULL, "precision" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'trip_stops');

UPDATE "trips" SET "start_day" = NULL, "end_day" = NULL, "start_zone" = NULL, "end_zone" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'trips');

UPDATE "trip_journal_entries" SET "day" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'trip_journal_entries');

UPDATE "lodging_stays" SET "check_in_date" = NULL, "check_out_date" = NULL,
       "check_in_at" = NULL, "check_out_at" = NULL, "stay_zone" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'lodging_stays');

UPDATE "users" SET "birth_day" = NULL, "birth_precision" = NULL
 WHERE "id" IN (SELECT "row_id" FROM "time_migration_ledger" WHERE "table_name" = 'users');

-- The inbox questions the backfill raised (they would re-appear from the
-- ledger on the next data-quality run, so they go together with it):
-- DELETE FROM "data_quality_flags" WHERE "kind" LIKE 'time\_%';

-- Only to run the backfill again:
-- DELETE FROM "time_migration_ledger";
-- UPDATE "admin_settings" SET "time_model_backfill_at" = NULL;
