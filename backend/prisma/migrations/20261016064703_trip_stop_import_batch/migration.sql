-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "import_batch_id" TEXT;

-- CreateIndex
CREATE INDEX "trip_stops_import_batch_id_idx" ON "trip_stops"("import_batch_id");

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
