-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "photo_journey_last_scan_at" TIMESTAMP(3),
ADD COLUMN     "photo_journey_last_scan_created" INTEGER,
ADD COLUMN     "photo_journey_last_scan_failure" TEXT,
ADD COLUMN     "photo_journey_last_scan_result" TEXT;
