-- AlterTable
ALTER TABLE "place_visit_photos" ADD COLUMN     "trip_photo_id" TEXT;

-- CreateIndex
CREATE INDEX "place_visit_photos_trip_photo_id_idx" ON "place_visit_photos"("trip_photo_id");

-- AddForeignKey
ALTER TABLE "place_visit_photos" ADD CONSTRAINT "place_visit_photos_trip_photo_id_fkey" FOREIGN KEY ("trip_photo_id") REFERENCES "trip_photos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
