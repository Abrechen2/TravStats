-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "fx_fallback_custom_url" TEXT,
ADD COLUMN     "fx_fallback_source" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "fx_primary_custom_url" TEXT,
ADD COLUMN     "fx_primary_source" TEXT NOT NULL DEFAULT 'frankfurter';
