-- Post-V2 schema drift fix
--
-- Hand-written like 20260419140000_schema_drift_fix to keep the changes
-- safe and idempotent across the three environments that will see this
-- migration:
--   * fresh dev DBs (no rows, postgis image)
--   * CT 106 beta (rows present, postgis image)
--   * CT 100 prod (rows present, plain postgres image — must switch to
--     postgis/postgis BEFORE this migration runs as part of V2 promotion)
--
-- Resolves three drift items found by `npm run check:drift` on
-- 2026-04-30:
--
--   1. PostGIS extension declared in schema.prisma (postgresqlExtensions
--      preview feature) but never installed by a migration. PostGIS is
--      already required by the cruise-routes geometry pipeline; this
--      migration just makes the dependency explicit in the migration
--      history.
--
--   2. cruises.updated_at had a SQL DEFAULT CURRENT_TIMESTAMP from the
--      original cruise_fixups migration, but the schema decoration is
--      Prisma's @updatedAt — which has the client populate the value on
--      every update and does NOT translate to a SQL default. Drop the
--      DB-level default to match the schema; Prisma client always sets
--      the column on writes, and there are no raw-SQL inserters of the
--      cruises table.
--
--   3. flights.dep_time_semantics / arr_time_semantics had a DEFAULT
--      'UNKNOWN' from the flight_time_semantics migration. The
--      canonical-UTC release (v1.2.0, 2026-04-27) made UTC the new
--      default semantics for all newly-imported flights, and an
--      auto-backfill at boot already migrated existing rows to UTC.
--      Flip the DB defaults to UTC to match schema. Existing rows are
--      unaffected — this only governs columns omitted on INSERT.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- AlterTable
ALTER TABLE "cruises" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "flights" ALTER COLUMN "dep_time_semantics" SET DEFAULT 'UTC',
ALTER COLUMN "arr_time_semantics" SET DEFAULT 'UTC';
