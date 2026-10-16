-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "federation_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "federation_origin" TEXT,
ADD COLUMN     "federation_private_key" TEXT;

-- AlterTable
ALTER TABLE "comparison_peers" ADD COLUMN     "leaderboard_versions" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
