-- AlterTable
ALTER TABLE "places" ADD COLUMN     "cover_photo_id" TEXT;

-- AddForeignKey
ALTER TABLE "places" ADD CONSTRAINT "places_cover_photo_id_fkey" FOREIGN KEY ("cover_photo_id") REFERENCES "place_visit_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
