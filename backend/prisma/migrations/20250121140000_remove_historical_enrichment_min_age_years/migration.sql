-- Remove historical_enrichment_min_age_years from user_settings
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_settings') THEN
        ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "historical_enrichment_min_age_years";
    END IF;
END $$;
