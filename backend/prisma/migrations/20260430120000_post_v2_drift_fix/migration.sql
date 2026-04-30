-- Post-V2 schema drift fix
--
-- Hand-written like 20260419140000_schema_drift_fix to keep the changes
-- safe and idempotent across the environments that will see this
-- migration: fresh dev DBs, CT 106 beta (rows present), and any
-- production deployment running plain Postgres (the v2 release no
-- longer requires PostGIS — see 2026-04-30 decision below).
--
-- Resolves two drift items found by `npm run check:drift` on
-- 2026-04-30:
--
--   1. cruises.updated_at had a SQL DEFAULT CURRENT_TIMESTAMP from the
--      original cruise_fixups migration, but the schema decoration is
--      Prisma's @updatedAt — which has the client populate the value on
--      every update and does NOT translate to a SQL default. Drop the
--      DB-level default to match the schema; Prisma client always sets
--      the column on writes, and there are no raw-SQL inserters of the
--      cruises table.
--
--   2. flights.dep_time_semantics / arr_time_semantics had a DEFAULT
--      'UNKNOWN' from the flight_time_semantics migration. The
--      canonical-UTC release (v1.2.0, 2026-04-27) made UTC the new
--      default semantics for all newly-imported flights, and an
--      auto-backfill at boot already migrated existing rows to UTC.
--      Flip the DB defaults to UTC to match schema. Existing rows are
--      unaffected — this only governs columns omitted on INSERT.
--
-- A third drift item — the postgis extension — was originally addressed
-- here with `CREATE EXTENSION IF NOT EXISTS "postgis"`. That line was
-- removed before v2 ship: schema.prisma never used any geometry /
-- geography column, so the dependency was latent infra coupling that
-- would crash-loop the app on plain Postgres deployments. When real
-- spatial features land, a dedicated migration will reintroduce
-- postgis with a pre-flight check.

-- AlterTable
ALTER TABLE "cruises" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "flights" ALTER COLUMN "dep_time_semantics" SET DEFAULT 'UTC',
ALTER COLUMN "arr_time_semantics" SET DEFAULT 'UTC';
