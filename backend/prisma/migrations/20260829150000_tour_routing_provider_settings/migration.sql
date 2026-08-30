-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "global_graphhopper_api_key" TEXT,
ADD COLUMN     "global_openrouteservice_api_key" TEXT,
ADD COLUMN     "routing_custom_url" TEXT,
ADD COLUMN     "routing_provider" TEXT;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "graphhopper_api_key" TEXT,
ADD COLUMN     "openrouteservice_api_key" TEXT;

