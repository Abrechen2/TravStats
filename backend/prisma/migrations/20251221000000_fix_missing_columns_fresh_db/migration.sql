-- Fix: Add columns that were defined in early migrations (202501xx) which
-- run before the init migration creates the base tables. On a fresh DB,
-- those migrations were applied as no-ops (IF EXISTS returned false).
-- This migration ensures all required columns exist, using ADD COLUMN IF NOT EXISTS
-- so it is safe to run on existing DBs where the columns already exist.

-- From 20250120120000: flight_number on flights
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "flight_number" TEXT;

-- From 20250120130000: flight API keys on user_settings
ALTER TABLE "user_settings"
    ADD COLUMN IF NOT EXISTS "airlabs_api_key" TEXT,
    ADD COLUMN IF NOT EXISTS "aviationstack_api_key" TEXT,
    ADD COLUMN IF NOT EXISTS "opensky_client_id" TEXT,
    ADD COLUMN IF NOT EXISTS "opensky_client_secret" TEXT,
    ADD COLUMN IF NOT EXISTS "opensky_username" TEXT,
    ADD COLUMN IF NOT EXISTS "opensky_password" TEXT;

-- From 20250120130000: global flight API keys on admin_settings
ALTER TABLE "admin_settings"
    ADD COLUMN IF NOT EXISTS "global_airlabs_api_key" TEXT,
    ADD COLUMN IF NOT EXISTS "global_aviationstack_api_key" TEXT,
    ADD COLUMN IF NOT EXISTS "global_opensky_client_id" TEXT,
    ADD COLUMN IF NOT EXISTS "global_opensky_client_secret" TEXT,
    ADD COLUMN IF NOT EXISTS "global_opensky_username" TEXT,
    ADD COLUMN IF NOT EXISTS "global_opensky_password" TEXT,
    ADD COLUMN IF NOT EXISTS "allow_user_flight_api_keys" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "require_user_flight_api_keys" BOOLEAN NOT NULL DEFAULT false;

-- From 20250120120000: auto-update settings on user_settings
ALTER TABLE "user_settings"
    ADD COLUMN IF NOT EXISTS "auto_update_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "auto_update_require_approval" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "auto_update_check_interval" INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN IF NOT EXISTS "auto_update_only_during_flight" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS "auto_update_expiry_hours" INTEGER NOT NULL DEFAULT 24;

-- From 20250121120000: route tracking on flights
ALTER TABLE "flights"
    ADD COLUMN IF NOT EXISTS "actual_route" JSONB,
    ADD COLUMN IF NOT EXISTS "overflown_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS "route_distance" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "route_source" TEXT,
    ADD COLUMN IF NOT EXISTS "has_live_tracking" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "data_source" TEXT,
    ADD COLUMN IF NOT EXISTS "last_modified_by" TEXT,
    ADD COLUMN IF NOT EXISTS "enrichment_history" JSONB;

-- From 20250121120000: historical enrichment settings on user_settings
ALTER TABLE "user_settings"
    ADD COLUMN IF NOT EXISTS "historical_enrichment_enabled" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "historical_enrichment_min_confidence" INTEGER DEFAULT 60,
    ADD COLUMN IF NOT EXISTS "historical_enrichment_max_age_years" INTEGER DEFAULT 5,
    ADD COLUMN IF NOT EXISTS "historical_enrichment_auto_process" BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS "historical_enrichment_max_per_day" INTEGER DEFAULT 50,
    ADD COLUMN IF NOT EXISTS "historical_enrichment_require_approval" BOOLEAN DEFAULT true;

-- From 20250121130000: boarding pass parser strategy on user_settings
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "boarding_pass_parser_strategy" TEXT;

-- From 20250121140000: remove historical_enrichment_min_age_years (was added then removed)
ALTER TABLE "user_settings" DROP COLUMN IF EXISTS "historical_enrichment_min_age_years";

-- From 20250121120000: metadata on pending_flight_updates
ALTER TABLE "pending_flight_updates" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Recreate index for flight_number if not already exists
CREATE INDEX IF NOT EXISTS "flights_flight_number_idx" ON "flights"("flight_number");
