-- Adds an admin-configurable daily cap for Aviationstack API calls.
-- Free tier is 100 requests/month (~3/day). Default 3 is conservative
-- and can be raised via admin UI when on a paid plan.
-- Set to 0 to disable Aviationstack entirely (fallback chain still works
-- via AirLabs + OpenSky).
ALTER TABLE "admin_settings"
  ADD COLUMN "aviationstack_daily_budget" INTEGER NOT NULL DEFAULT 3;
