-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "web_prefs" JSONB,
ADD COLUMN     "web_prefs_updated_at" TIMESTAMP(3);
