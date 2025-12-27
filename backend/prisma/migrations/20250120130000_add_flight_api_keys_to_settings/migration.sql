-- AlterTable: Add flight lookup API keys to UserSettings
ALTER TABLE "user_settings" 
ADD COLUMN IF NOT EXISTS "airlabs_api_key" TEXT,
ADD COLUMN IF NOT EXISTS "aviationstack_api_key" TEXT,
ADD COLUMN IF NOT EXISTS "opensky_client_id" TEXT,
ADD COLUMN IF NOT EXISTS "opensky_client_secret" TEXT,
ADD COLUMN IF NOT EXISTS "opensky_username" TEXT,
ADD COLUMN IF NOT EXISTS "opensky_password" TEXT;

-- AlterTable: Add global flight lookup API keys to AdminSettings
ALTER TABLE "admin_settings" 
ADD COLUMN IF NOT EXISTS "global_airlabs_api_key" TEXT,
ADD COLUMN IF NOT EXISTS "global_aviationstack_api_key" TEXT,
ADD COLUMN IF NOT EXISTS "global_opensky_client_id" TEXT,
ADD COLUMN IF NOT EXISTS "global_opensky_client_secret" TEXT,
ADD COLUMN IF NOT EXISTS "global_opensky_username" TEXT,
ADD COLUMN IF NOT EXISTS "global_opensky_password" TEXT,
ADD COLUMN IF NOT EXISTS "allow_user_flight_api_keys" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "require_user_flight_api_keys" BOOLEAN NOT NULL DEFAULT false;

