-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "adsb_lol_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "global_adsblol_api_key" TEXT,
ADD COLUMN     "global_adsbx_api_key" TEXT;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "adsblol_api_key" TEXT,
ADD COLUMN     "adsbx_api_key" TEXT;
