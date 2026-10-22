-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "cruise_count_sea_days" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "flight_live_tracking_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "trip_default_color" TEXT;
