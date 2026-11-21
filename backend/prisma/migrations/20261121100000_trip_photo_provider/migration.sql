-- A trip photo imported from a photo source names which source its asset id
-- belongs to: an id is only unique per source, so the provider joins the key.
-- Existing rows are Immich imports, which the column default records.

-- DropIndex
DROP INDEX "trip_photos_trip_id_immich_asset_id_key";

-- AlterTable
ALTER TABLE "trip_photos" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'immich';

-- CreateIndex
CREATE UNIQUE INDEX "trip_photos_trip_id_provider_immich_asset_id_key" ON "trip_photos"("trip_id", "provider", "immich_asset_id");
