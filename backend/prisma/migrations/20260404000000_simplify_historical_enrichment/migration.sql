-- Remove redundant historical enrichment columns from user_settings
-- These are replaced by hardcoded business logic:
--   maxAgeYears  → replaced by 1-year full/slim split in service
--   autoProcess  → scheduler always runs for enabled users
--   requireApproval → always true, not configurable
ALTER TABLE "user_settings"
  DROP COLUMN IF EXISTS "historical_enrichment_max_age_years",
  DROP COLUMN IF EXISTS "historical_enrichment_auto_process",
  DROP COLUMN IF EXISTS "historical_enrichment_require_approval";
