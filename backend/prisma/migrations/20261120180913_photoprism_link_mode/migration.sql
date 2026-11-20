/*
  Warnings:

  - A unique constraint covering the columns `[trip_id,provider,immich_album_id]` on the table `trip_immich_albums` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "trip_immich_albums_trip_id_immich_album_id_key";

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "global_photoprism_base_url" TEXT,
ADD COLUMN     "global_photoprism_token" TEXT;

-- AlterTable
ALTER TABLE "trip_immich_albums" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'immich';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "photoprism_base_url" TEXT,
ADD COLUMN     "photoprism_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "trip_immich_albums_trip_id_provider_immich_album_id_key" ON "trip_immich_albums"("trip_id", "provider", "immich_album_id");
