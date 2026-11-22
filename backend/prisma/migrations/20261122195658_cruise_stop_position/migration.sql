-- AlterTable
ALTER TABLE "cruise_stops" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Backfill (forgejo#438): cruise_stops has no created_at, so insertion order is
-- not recoverable. Freeze the order every reader showed until now (day,
-- arrival, departure, id) as the starting position; ties that were already
-- random stay as they were, and the user can now reorder them.
UPDATE "cruise_stops" AS s
SET "position" = r.pos
FROM (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "cruise_id"
           ORDER BY "day_number", "arrival_time" ASC NULLS LAST, "departure_time" ASC NULLS LAST, "id"
         ) - 1 AS pos
  FROM "cruise_stops"
) AS r
WHERE s."id" = r."id";
