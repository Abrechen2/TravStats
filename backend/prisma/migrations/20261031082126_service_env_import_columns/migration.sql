-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "env_imported_at" TIMESTAMP(3),
ADD COLUMN     "global_aisstream_api_key" TEXT,
ADD COLUMN     "market_overpass_url" TEXT,
ADD COLUMN     "own_geo_url" TEXT,
ADD COLUMN     "rail_lookup_contact" TEXT,
ADD COLUMN     "usage_stats_endpoint" TEXT;
