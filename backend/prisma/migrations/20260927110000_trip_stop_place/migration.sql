-- A roadtrip pass-through names the user's own place it passed (tester
-- 2026-09-26). See `TripStop.placeId`.
ALTER TABLE "trip_stops" ADD COLUMN "place_id" TEXT;

CREATE INDEX "trip_stops_place_id_idx" ON "trip_stops"("place_id");

ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_place_id_fkey"
  FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only a pass-through names a place. The SetNull above can only clear
-- `place_id`, so the cascade can never violate this.
ALTER TABLE "trip_stops"
  ADD CONSTRAINT "trip_stops_place_on_pass"
  CHECK ("place_id" IS NULL OR (NOT "overnight" AND NOT "via_point" AND "lodging_stay_id" IS NULL));
