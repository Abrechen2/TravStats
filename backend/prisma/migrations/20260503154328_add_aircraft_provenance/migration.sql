-- Phase 2 of the AeroDataBox enrichment roadmap: persist the rich
-- per-flight metadata that the API already returns at zero quota cost.
-- All columns are nullable — manually-entered flights stay untouched.
--
-- `data_source` is intentionally absent from this migration — it already
-- exists in the database from prior schema drift (see CLAUDE.md cruise-
-- migration note); we only sync the schema.prisma reference here so
-- Prisma stops fighting the existing column.
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "aircraft_registration"   TEXT;
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "aircraft_mode_s"         TEXT;
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "airline_iata"            TEXT;
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "airline_icao"            TEXT;
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "operating_airline_iata"  TEXT;
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "operating_airline_icao"  TEXT;
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "is_codeshare"            BOOLEAN;

-- Stat queries by tail number ("have I flown D-AIHX before?") need a
-- per-user index — registration alone is not unique across users.
CREATE INDEX IF NOT EXISTS "flights_user_id_aircraft_registration_idx"
  ON "flights" ("user_id", "aircraft_registration")
  WHERE "aircraft_registration" IS NOT NULL;
