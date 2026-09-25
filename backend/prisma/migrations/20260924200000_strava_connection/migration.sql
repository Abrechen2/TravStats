-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "strava_client_id" TEXT,
ADD COLUMN     "strava_client_secret" TEXT;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "strava_access_token" TEXT,
ADD COLUMN     "strava_athlete_id" TEXT,
ADD COLUMN     "strava_refresh_token" TEXT,
ADD COLUMN     "strava_scope" TEXT,
ADD COLUMN     "strava_token_expires_at" TIMESTAMP(3);
