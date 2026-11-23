-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "reroute_miss_at" TIMESTAMP(3),
ADD COLUMN     "reroute_miss_reason" TEXT;
