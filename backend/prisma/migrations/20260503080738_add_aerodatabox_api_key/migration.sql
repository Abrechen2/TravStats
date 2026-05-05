-- AeroDataBox provider key (per-user override + global admin default).
-- The key is encrypted at the application layer, same pattern as the
-- existing AirLabs / Aviationstack columns. Both columns are nullable
-- because the provider is opt-in.
ALTER TABLE "user_settings"  ADD COLUMN "aerodatabox_api_key"        TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "global_aerodatabox_api_key" TEXT;
