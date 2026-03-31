-- Add route tracking and data source fields to flights
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'flights') THEN
        ALTER TABLE "flights"
            ADD COLUMN IF NOT EXISTS "actual_route" JSONB,
            ADD COLUMN IF NOT EXISTS "overflown_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
            ADD COLUMN IF NOT EXISTS "route_distance" DOUBLE PRECISION,
            ADD COLUMN IF NOT EXISTS "route_source" TEXT,
            ADD COLUMN IF NOT EXISTS "has_live_tracking" BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS "data_source" TEXT,
            ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
            ADD COLUMN IF NOT EXISTS "enrichment_history" JSONB;
    END IF;
END $$;

-- Add historical enrichment settings to user_settings
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user_settings') THEN
        ALTER TABLE "user_settings"
            ADD COLUMN IF NOT EXISTS "historical_enrichment_enabled" BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS "historical_enrichment_min_confidence" INTEGER DEFAULT 60,
            ADD COLUMN IF NOT EXISTS "historical_enrichment_max_age_years" INTEGER DEFAULT 5,
            ADD COLUMN IF NOT EXISTS "historical_enrichment_min_age_years" INTEGER DEFAULT 2,
            ADD COLUMN IF NOT EXISTS "historical_enrichment_auto_process" BOOLEAN DEFAULT false,
            ADD COLUMN IF NOT EXISTS "historical_enrichment_max_per_day" INTEGER DEFAULT 50,
            ADD COLUMN IF NOT EXISTS "historical_enrichment_require_approval" BOOLEAN DEFAULT true;
    END IF;
END $$;

-- Add metadata field to pending_flight_updates
ALTER TABLE "pending_flight_updates" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
