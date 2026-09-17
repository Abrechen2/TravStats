-- AlterTable
ALTER TABLE "photo_journeys" ADD COLUMN     "airport_iata" TEXT,
ADD COLUMN     "created_lodging_stay_id" TEXT,
ADD COLUMN     "created_place_visit_id" TEXT,
ADD COLUMN     "distance_km" DOUBLE PRECISION,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'trip',
ADD COLUMN     "nights" INTEGER,
ADD COLUMN     "place_id" TEXT,
ADD COLUMN     "spread_km" DOUBLE PRECISION;

-- AddForeignKey
ALTER TABLE "photo_journeys" ADD CONSTRAINT "photo_journeys_place_id_fkey" FOREIGN KEY ("place_id") REFERENCES "places"("id") ON DELETE CASCADE ON UPDATE CASCADE;
