-- AlterTable
ALTER TABLE "trip_photos" ADD COLUMN     "stop_id" TEXT;

-- CreateIndex
CREATE INDEX "trip_photos_stop_id_idx" ON "trip_photos"("stop_id");

-- AddForeignKey
ALTER TABLE "trip_photos" ADD CONSTRAINT "trip_photos_stop_id_fkey" FOREIGN KEY ("stop_id") REFERENCES "trip_stops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
