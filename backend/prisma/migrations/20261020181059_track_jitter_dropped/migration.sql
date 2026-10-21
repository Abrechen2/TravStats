-- AlterTable
ALTER TABLE "cruise_tracks" ADD COLUMN     "jitter_dropped" INTEGER;

-- AlterTable
ALTER TABLE "flight_tracks" ADD COLUMN     "jitter_dropped" INTEGER;

-- AlterTable
ALTER TABLE "trip_route_tracks" ADD COLUMN     "jitter_dropped" INTEGER;
