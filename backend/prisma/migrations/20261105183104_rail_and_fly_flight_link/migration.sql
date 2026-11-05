-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "rail_and_fly_flight_id" TEXT;

-- CreateIndex
CREATE INDEX "rail_journeys_rail_and_fly_flight_id_idx" ON "rail_journeys"("rail_and_fly_flight_id");

-- AddForeignKey
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_rail_and_fly_flight_id_fkey" FOREIGN KEY ("rail_and_fly_flight_id") REFERENCES "flights"("id") ON DELETE SET NULL ON UPDATE CASCADE;
