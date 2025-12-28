-- Remove historical_enrichment_min_age_years from user_settings
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "historical_enrichment_min_age_years";

