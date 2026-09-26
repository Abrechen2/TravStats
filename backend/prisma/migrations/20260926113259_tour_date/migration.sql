-- A standalone day tour gets its day (acceptance D2, 2026-09-26): without it
-- the trip suggestions, which place entries by day, could never include one.
ALTER TABLE "trip_routes" ADD COLUMN     "tour_date" DATE,
ADD COLUMN     "tour_start_minute" INTEGER;

-- A start time is a time OF that day: never without the day, never outside it.
ALTER TABLE "trip_routes" ADD CONSTRAINT "trip_routes_tour_start_minute"
  CHECK ("tour_start_minute" IS NULL
    OR ("tour_date" IS NOT NULL AND "tour_start_minute" BETWEEN 0 AND 1439));
