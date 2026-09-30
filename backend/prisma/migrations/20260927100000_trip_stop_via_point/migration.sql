-- A route correction point on a roadtrip or tour (tester 2026-09-26): a
-- vertex the route bends through, not a station. See `TripStop.viaPoint`.
ALTER TABLE "trip_stops" ADD COLUMN "via_point" BOOLEAN NOT NULL DEFAULT false;

-- A via point is never a night. The stay link is SetNull on the stay side,
-- which can only clear `lodging_stay_id`, so the cascade can never violate
-- this (unlike the trap migration 20260921195505 met with a stored enum).
ALTER TABLE "trip_stops"
  ADD CONSTRAINT "trip_stops_via_point_passes"
  CHECK (NOT "via_point" OR (NOT "overnight" AND "lodging_stay_id" IS NULL));
