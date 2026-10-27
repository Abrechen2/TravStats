-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "trav_plan_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Backfill (hand-written): an account that already holds a plan keeps TravPlan on.
-- The switch defaults to off like every domain but flights, and until today
-- TravPlan was an instance switch alone, so off here would have hidden the
-- planning area from exactly the people using it.
UPDATE "user_settings" AS s
SET "trav_plan_enabled" = true
WHERE EXISTS (
  SELECT 1 FROM "travel_plans" p JOIN "trips" t ON t."id" = p."trip_id"
  WHERE t."user_id" = s."user_id"
);

-- A plan holder without a settings row (one who only ever used the app) gets one,
-- or the column default would switch them off. An empty blob is what the clients
-- merge their defaults over.
INSERT INTO "user_settings" ("id", "user_id", "data", "updated_at", "trav_plan_enabled")
SELECT gen_random_uuid()::text, t."user_id", '{}'::jsonb, CURRENT_TIMESTAMP, true
FROM "travel_plans" p JOIN "trips" t ON t."id" = p."trip_id"
WHERE NOT EXISTS (SELECT 1 FROM "user_settings" s WHERE s."user_id" = t."user_id")
GROUP BY t."user_id";
