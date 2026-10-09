-- AlterTable
ALTER TABLE "photo_journeys" ADD COLUMN     "suggested_category" TEXT,
ADD COLUMN     "suggested_local_name" TEXT,
ADD COLUMN     "suggested_name" TEXT,
ADD COLUMN     "suggested_ref" TEXT,
ADD COLUMN     "trip_id" TEXT;

-- AddForeignKey
ALTER TABLE "photo_journeys" ADD CONSTRAINT "photo_journeys_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
