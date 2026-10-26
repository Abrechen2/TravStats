-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "location_provider" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "location_provider_rev" INTEGER NOT NULL DEFAULT 0;

-- The three values, held by the database (hand-appended; Prisma has no enum-less CHECK).
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_location_provider_check"
  CHECK ("location_provider" IN ('none', 'travtrack', 'dawarich'));

-- Backfill: whoever has their OWN Dawarich connection today keeps every automatic
-- Dawarich feature. Only the user tier — the unattended jobs already read that tier
-- alone (services/dawarich/dawarichResolver.ts), so nobody's behaviour changes.
UPDATE "user_settings" SET "location_provider" = 'dawarich'
  WHERE "dawarich_base_url" IS NOT NULL AND "dawarich_api_key" IS NOT NULL;
