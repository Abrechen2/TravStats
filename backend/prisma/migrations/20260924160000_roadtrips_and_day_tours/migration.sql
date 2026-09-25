-- AlterTable
ALTER TABLE "trip_route_tracks" ADD COLUMN     "ascent_m" DOUBLE PRECISION,
ADD COLUMN     "descent_m" DOUBLE PRECISION,
ADD COLUMN     "elevations" JSONB,
ADD COLUMN     "external_ref" TEXT,
ADD COLUMN     "moving_seconds" INTEGER;

-- AlterTable
ALTER TABLE "trip_routes" ADD COLUMN     "activity" TEXT,
ADD COLUMN     "anchor_stop_id" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'tour',
ADD COLUMN     "kind_assigned_automatically" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vehicle" TEXT,
ADD COLUMN     "vehicle_name" TEXT;

-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "lodging_stay_id" TEXT,
ADD COLUMN     "overnight" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "trip_route_tracks_route_id_external_ref_key" ON "trip_route_tracks"("route_id", "external_ref");

-- CreateIndex
CREATE INDEX "trip_routes_user_id_kind_idx" ON "trip_routes"("user_id", "kind");

-- CreateIndex
CREATE INDEX "trip_routes_anchor_stop_id_idx" ON "trip_routes"("anchor_stop_id");

-- CreateIndex
CREATE INDEX "trip_stops_lodging_stay_id_idx" ON "trip_stops"("lodging_stay_id");

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_lodging_stay_id_fkey" FOREIGN KEY ("lodging_stay_id") REFERENCES "lodging_stays"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_routes" ADD CONSTRAINT "trip_routes_anchor_stop_id_fkey" FOREIGN KEY ("anchor_stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Classify the rows that exist (design 2026-09-24 §3.4), and flag every one
-- of them so the UI can list the rule's decisions once for the owner to
-- correct. A road/ferry/rail section whose stops span at least one night is a
-- roadtrip; everything else stays a tour. A multi-night bike trip therefore
-- lands as a tour — the reason the flag exists.
UPDATE "trip_routes" AS r
SET "kind" = 'roadtrip'
WHERE r."mode" IN ('road', 'ferry', 'rail')
  AND (
    SELECT MAX(COALESCE(s."end_date", s."start_date"))::date - MIN(s."start_date")::date
    FROM "trip_stops" AS s
    WHERE s."route_id" = r."id"
  ) >= 1;

UPDATE "trip_routes"
SET "activity" = CASE "mode" WHEN 'foot' THEN 'hike' WHEN 'bike' THEN 'bike' ELSE NULL END
WHERE "kind" = 'tour';

UPDATE "trip_routes" SET "kind_assigned_automatically" = true;
