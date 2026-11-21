-- AlterTable
ALTER TABLE "trip_expenses" ADD COLUMN     "place_visit_id" TEXT;

-- CreateIndex
CREATE INDEX "trip_expenses_place_visit_id_idx" ON "trip_expenses"("place_visit_id");

-- AddForeignKey
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_place_visit_id_fkey" FOREIGN KEY ("place_visit_id") REFERENCES "place_visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
