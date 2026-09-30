-- Self-hosted OpenRailRouting base URL for rail journey geometry (rail-domain
-- phase 3). Null = off, the default.
ALTER TABLE "admin_settings" ADD COLUMN "rail_routing_url" TEXT;
