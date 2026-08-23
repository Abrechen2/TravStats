-- Backfill: TripStop rows with domain='poi' become Place + PlaceVisit.
--
-- This is the EXPAND half of an expand/contract pair. It only COPIES; the
-- matching DELETE of the migrated `trip_stops` rows ships one release later,
-- so a bad backfill is recoverable from rows that are still present. Until
-- then a migrated POI is visible twice on a trip timeline, which the trip
-- timeline builder suppresses by ignoring `domain='poi'` stops that already
-- have a `place_visits` row (see lib/tripTimeline.ts).
--
-- Three things this deliberately does NOT do:
--
--   1. It does not touch stops with any other `domain` (hotel, train, hike,
--      NULL). TripStop survives as the generic timeline primitive.
--   2. It does not migrate stops without coordinates. `places.lat/lon` are
--      NOT NULL because a place that cannot be drawn defeats the domain, and
--      inventing a position — or deleting the user's text to satisfy a schema
--      — are both worse than leaving those rows exactly where they are.
--      They stay TripStops and keep rendering as they do today.
--   3. It does not guess `category`. Everything lands in 'other'; the user
--      re-categorises at leisure. A wrong guess is worse than an honest blank
--      because only the icon depends on it.
--
-- Dedup: one Place per (user, name, position rounded to ~11 m). Two stops
-- called "Trevi-Brunnen" at the same coordinates on two different trips are
-- one place with two visits — which is the entire point of the domain.

-- 1. One Place per distinct (user, title, rounded position).
INSERT INTO "places" (
  "id", "user_id", "name", "category", "lat", "lon",
  "visited", "notes", "data_source", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  t."user_id",
  s."title",
  'other',
  -- Store the rounded coordinate the grouping was done on, so the Place a
  -- visit points at is exactly the one its key was derived from.
  ROUND(s."lat"::numeric, 4)::double precision,
  ROUND(s."lon"::numeric, 4)::double precision,
  TRUE,                       -- these describe places the user really went to
  -- Only one note survives per merged group; pick deterministically rather
  -- than at random so a re-run cannot produce a different result.
  MIN(s."notes"),
  'manual',
  MIN(s."created_at"),
  MAX(s."updated_at")
FROM "trip_stops" s
JOIN "trips" t ON t."id" = s."trip_id"
WHERE s."domain" = 'poi'
  AND s."lat" IS NOT NULL
  AND s."lon" IS NOT NULL
GROUP BY t."user_id", s."title", ROUND(s."lat"::numeric, 4), ROUND(s."lon"::numeric, 4);

-- 2. One PlaceVisit per original stop, keeping its trip link and its date.
--    `start_date` becomes `visited_at`: it is already a timestamp column, so
--    a stop that carried a time keeps it and #175 ordering survives.
INSERT INTO "place_visits" (
  "id", "place_id", "user_id", "trip_id",
  "visited_at", "order_idx", "notes", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(),
  p."id",
  t."user_id",
  s."trip_id",
  s."start_date",
  s."order_idx",
  s."notes",
  s."created_at",
  s."updated_at"
FROM "trip_stops" s
JOIN "trips" t ON t."id" = s."trip_id"
JOIN "places" p
  ON p."user_id" = t."user_id"
 AND p."name" = s."title"
 AND p."lat" = ROUND(s."lat"::numeric, 4)::double precision
 AND p."lon" = ROUND(s."lon"::numeric, 4)::double precision
WHERE s."domain" = 'poi'
  AND s."lat" IS NOT NULL
  AND s."lon" IS NOT NULL;

-- 3. Record which stops were migrated, so the later contract migration can
--    delete exactly these and nothing else — and so an operator can audit the
--    backfill without reconstructing the join. Dropped by the contract half.
CREATE TABLE IF NOT EXISTS "_poi_backfill_audit" (
  "trip_stop_id" TEXT PRIMARY KEY,
  "place_visit_id" TEXT NOT NULL,
  "migrated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "_poi_backfill_audit" ("trip_stop_id", "place_visit_id")
SELECT s."id", v."id"
FROM "trip_stops" s
JOIN "trips" t ON t."id" = s."trip_id"
JOIN "places" p
  ON p."user_id" = t."user_id"
 AND p."name" = s."title"
 AND p."lat" = ROUND(s."lat"::numeric, 4)::double precision
 AND p."lon" = ROUND(s."lon"::numeric, 4)::double precision
JOIN "place_visits" v
  ON v."place_id" = p."id"
 AND v."trip_id" = s."trip_id"
 AND v."order_idx" = s."order_idx"
 AND v."created_at" = s."created_at"
WHERE s."domain" = 'poi'
  AND s."lat" IS NOT NULL
  AND s."lon" IS NOT NULL
ON CONFLICT ("trip_stop_id") DO NOTHING;
