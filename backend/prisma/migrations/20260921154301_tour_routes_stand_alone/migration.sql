-- A tour may stand on its own (owner ruling 2026-09-21: "Sie können auch
-- einzeln leben"). Two things have to change for that, and one has to be
-- guarded.
--
-- 1. `trip_routes` gains its own owner. Until now the owner was read
--    through the trip, and a tour with no trip has no trip to read one
--    from. Backfilled from the trip before the column is made NOT NULL,
--    so an existing tour keeps exactly the owner it already had.
-- 2. `trip_routes.trip_id` and `trip_stops.trip_id` become nullable.
-- 3. A stop with NEITHER a trip nor a route would belong to nobody and be
--    reachable from nothing, so a CHECK refuses it outright.

-- 1 -------------------------------------------------------------------
ALTER TABLE "trip_routes" ADD COLUMN "user_id" TEXT;

UPDATE "trip_routes" r
   SET "user_id" = t."user_id"
  FROM "trips" t
 WHERE t."id" = r."trip_id"
   AND r."user_id" IS NULL;

-- Nothing may be left over: every existing row had a trip, because the
-- column it is derived from was NOT NULL until this migration.
DELETE FROM "trip_routes" WHERE "user_id" IS NULL;

ALTER TABLE "trip_routes" ALTER COLUMN "user_id" SET NOT NULL;

-- 2 -------------------------------------------------------------------
ALTER TABLE "trip_routes" ALTER COLUMN "trip_id" DROP NOT NULL;
ALTER TABLE "trip_stops"  ALTER COLUMN "trip_id" DROP NOT NULL;

-- 3 -------------------------------------------------------------------
ALTER TABLE "trip_stops"
  ADD CONSTRAINT "trip_stops_trip_or_route"
  CHECK ("trip_id" IS NOT NULL OR "route_id" IS NOT NULL);

-- Index + foreign key --------------------------------------------------
CREATE INDEX "trip_routes_user_id_idx" ON "trip_routes"("user_id");

ALTER TABLE "trip_routes" ADD CONSTRAINT "trip_routes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
