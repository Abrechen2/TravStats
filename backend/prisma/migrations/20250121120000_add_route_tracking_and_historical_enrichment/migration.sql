-- Add route tracking fields to flights
ALTER TABLE "flights" ADD COLUMN     "actual_route" JSONB,
ADD COLUMN     "overflown_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "route_distance" DOUBLE PRECISION,
ADD COLUMN     "route_source" TEXT,
ADD COLUMN     "has_live_tracking" BOOLEAN DEFAULT false;

-- Add data source tracking fields to flights
ALTER TABLE "flights" ADD COLUMN     "data_source" TEXT,
ADD COLUMN     "last_modified_by" TEXT,
ADD COLUMN     "enrichment_history" JSONB;

-- Add historical enrichment settings to user_settings
ALTER TABLE "user_settings" ADD COLUMN     "historical_enrichment_enabled" BOOLEAN DEFAULT false,
ADD COLUMN     "historical_enrichment_min_confidence" INTEGER DEFAULT 60,
ADD COLUMN     "historical_enrichment_max_age_years" INTEGER DEFAULT 5,
ADD COLUMN     "historical_enrichment_min_age_years" INTEGER DEFAULT 2,
ADD COLUMN     "historical_enrichment_auto_process" BOOLEAN DEFAULT false,
ADD COLUMN     "historical_enrichment_max_per_day" INTEGER DEFAULT 50,
ADD COLUMN     "historical_enrichment_require_approval" BOOLEAN DEFAULT true;

-- Add metadata field to pending_flight_updates
ALTER TABLE "pending_flight_updates" ADD COLUMN     "metadata" JSONB;

