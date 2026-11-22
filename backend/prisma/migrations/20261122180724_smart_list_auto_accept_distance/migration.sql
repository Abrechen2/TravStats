-- AlterTable
ALTER TABLE "place_list_brand_rules" ADD COLUMN     "auto_accept_distance_m" INTEGER NOT NULL DEFAULT 60,
ALTER COLUMN "max_distance_m" SET DEFAULT 100;
