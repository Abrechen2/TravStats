-- AlterTable
ALTER TABLE "ferry_journeys" ADD COLUMN     "roadtrip_leg_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ferry_journeys_roadtrip_leg_id_key" ON "ferry_journeys"("roadtrip_leg_id");

-- AddForeignKey
ALTER TABLE "ferry_journeys" ADD CONSTRAINT "ferry_journeys_roadtrip_leg_id_fkey" FOREIGN KEY ("roadtrip_leg_id") REFERENCES "trip_route_legs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
