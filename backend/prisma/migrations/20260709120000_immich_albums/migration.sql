-- Immich album integration, Phase A (#154).
--
-- Hand-written (not `prisma migrate dev`-generated) on purpose: the existing
-- schema has pre-existing drift vs. the migration history (see CLAUDE.md),
-- which `prisma migrate dev` would bundle into any new migration and break
-- prod on deploy. Everything below is additive — nullable columns, new
-- tables, new indexes. No existing row is rewritten.

-- Settings: per-user Immich connection + copy/link preference.
ALTER TABLE "user_settings" ADD COLUMN "immich_base_url" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "immich_api_key" TEXT;
ALTER TABLE "user_settings" ADD COLUMN "immich_default_mode" TEXT NOT NULL DEFAULT 'link';

-- Settings: admin-global Immich connection (tier 2 of the resolver).
ALTER TABLE "admin_settings" ADD COLUMN "global_immich_base_url" TEXT;
ALTER TABLE "admin_settings" ADD COLUMN "global_immich_api_key" TEXT;

-- CreateTable
CREATE TABLE "trip_immich_albums" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "immich_album_id" TEXT NOT NULL,
    "album_name" TEXT NOT NULL,
    "asset_count" INTEGER NOT NULL DEFAULT 0,
    "thumbnail_asset_id" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'link',
    "sort_idx" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_immich_albums_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "trip_immich_albums_trip_id_immich_album_id_key"
    ON "trip_immich_albums"("trip_id", "immich_album_id");
CREATE INDEX "trip_immich_albums_trip_id_idx" ON "trip_immich_albums"("trip_id");

ALTER TABLE "trip_immich_albums"
    ADD CONSTRAINT "trip_immich_albums_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "immich_import_jobs" (
    "id" TEXT NOT NULL,
    "album_link_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total_assets" INTEGER NOT NULL DEFAULT 0,
    "processed_assets" INTEGER NOT NULL DEFAULT 0,
    "failed_assets" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "immich_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "immich_import_jobs_album_link_id_key"
    ON "immich_import_jobs"("album_link_id");

ALTER TABLE "immich_import_jobs"
    ADD CONSTRAINT "immich_import_jobs_album_link_id_fkey"
    FOREIGN KEY ("album_link_id") REFERENCES "trip_immich_albums"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Trip photos: Immich provenance + EXIF coordinates.
-- The (trip_id, immich_asset_id) unique index is what makes re-sync idempotent.
-- Postgres treats NULLs as distinct, so unlimited manual uploads still fit.
ALTER TABLE "trip_photos" ADD COLUMN "immich_asset_id" TEXT;
ALTER TABLE "trip_photos" ADD COLUMN "immich_album_link_id" TEXT;
ALTER TABLE "trip_photos" ADD COLUMN "lat" DOUBLE PRECISION;
ALTER TABLE "trip_photos" ADD COLUMN "lon" DOUBLE PRECISION;

CREATE UNIQUE INDEX "trip_photos_trip_id_immich_asset_id_key"
    ON "trip_photos"("trip_id", "immich_asset_id");
CREATE INDEX "trip_photos_immich_album_link_id_idx"
    ON "trip_photos"("immich_album_link_id");

ALTER TABLE "trip_photos"
    ADD CONSTRAINT "trip_photos_immich_album_link_id_fkey"
    FOREIGN KEY ("immich_album_link_id") REFERENCES "trip_immich_albums"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
