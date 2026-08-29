-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "global_dawarich_api_key" TEXT,
ADD COLUMN     "global_dawarich_base_url" TEXT;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "dawarich_api_key" TEXT,
ADD COLUMN     "dawarich_base_url" TEXT;
