-- Drop a duplicate (visit, asset) link before the unique key below; the code never wrote one, a race could have.
DELETE FROM "place_visit_photos" a USING "place_visit_photos" b
WHERE a.immich_asset_id IS NOT NULL AND a.place_visit_id = b.place_visit_id
  AND a.immich_asset_id = b.immich_asset_id AND a.id > b.id;


-- DropIndex
DROP INDEX "visit_photo_refusals_place_visit_id_kind_suggestion_id_key";

-- AlterTable
ALTER TABLE "place_visit_photos" ADD COLUMN     "provenance" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'immich';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "auto_link_visit_photos" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "visit_photo_auto_link_last_run" JSONB;

-- AlterTable
ALTER TABLE "visit_photo_refusals" ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'immich';

-- CreateIndex
CREATE UNIQUE INDEX "place_visit_photos_place_visit_id_provider_immich_asset_id_key" ON "place_visit_photos"("place_visit_id", "provider", "immich_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "visit_photo_refusals_place_visit_id_kind_provider_suggestio_key" ON "visit_photo_refusals"("place_visit_id", "kind", "provider", "suggestion_id");

