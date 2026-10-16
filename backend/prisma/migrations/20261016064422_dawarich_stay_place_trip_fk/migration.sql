-- Findings written before these keys existed may name a place or trip that was
-- deleted or merged away (or, never by design, one of another account). The
-- link is cleared; the finding and its evidence stay.
UPDATE "dawarich_stays" AS s SET "place_id" = NULL
WHERE s."place_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "places" p WHERE p."id" = s."place_id" AND p."user_id" = s."user_id");

UPDATE "dawarich_stays" AS s SET "trip_id" = NULL
WHERE s."trip_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "trips" t WHERE t."id" = s."trip_id" AND t."user_id" = s."user_id");

-- CreateIndex
CREATE INDEX "dawarich_stays_place_id_idx" ON "dawarich_stays"("place_id");

-- CreateIndex
CREATE INDEX "dawarich_stays_trip_id_idx" ON "dawarich_stays"("trip_id");

-- AddForeignKey
ALTER TABLE "dawarich_stays" ADD CONSTRAINT "dawarich_stays_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dawarich_stays" ADD CONSTRAINT "dawarich_stays_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;
