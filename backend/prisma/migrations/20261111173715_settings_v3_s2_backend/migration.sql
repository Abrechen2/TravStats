-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "debug_until" TIMESTAMP(3),
ADD COLUMN     "internet_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "display_currency" TEXT,
ADD COLUMN     "google_api_key" TEXT,
ADD COLUMN     "google_places_api_key" TEXT,
ADD COLUMN     "trav_plan_ai_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "trav_plan_weather_enabled" BOOLEAN NOT NULL DEFAULT true;
