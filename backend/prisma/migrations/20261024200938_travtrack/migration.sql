-- CreateTable
CREATE TABLE "travtrack_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travtrack_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_points" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "user_id" TEXT NOT NULL,
    "t" TIMESTAMP(3) NOT NULL,
    "t_s" INTEGER NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "accuracy_m" DOUBLE PRECISION,
    "altitude_m" DOUBLE PRECISION,
    "speed_mps" DOUBLE PRECISION,
    "course" DOUBLE PRECISION,
    "motion" TEXT,
    "origin" TEXT NOT NULL,
    "origin_ref" TEXT NOT NULL,
    "device_id" TEXT,
    "purpose" TEXT NOT NULL DEFAULT 'everyday',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_point_links" (
    "user_id" TEXT NOT NULL,
    "point_id" TEXT NOT NULL,
    "entry_kind" TEXT NOT NULL,
    "entry_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_point_links_pkey" PRIMARY KEY ("point_id","entry_kind","entry_id")
);

-- CreateTable
CREATE TABLE "travtrack_uploads" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_deleted_ranges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_at" TIMESTAMP(3) NOT NULL,
    "to_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_deleted_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_privacy_zones" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "radius_m" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travtrack_privacy_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_gaps" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "from_at" TIMESTAMP(3) NOT NULL,
    "to_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travtrack_share_snapshots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "geometry" JSONB NOT NULL,
    "point_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_share_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_points_seq_key" ON "travtrack_points"("seq");

-- CreateIndex
CREATE INDEX "travtrack_points_user_id_t_seq_idx" ON "travtrack_points"("user_id", "t", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_points_user_id_t_s_lon_lat_key" ON "travtrack_points"("user_id", "t_s", "lon", "lat");

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_points_user_id_origin_origin_ref_key" ON "travtrack_points"("user_id", "origin", "origin_ref");

-- CreateIndex
CREATE INDEX "travtrack_point_links_user_id_entry_kind_entry_id_idx" ON "travtrack_point_links"("user_id", "entry_kind", "entry_id");

-- CreateIndex
CREATE INDEX "travtrack_uploads_created_at_idx" ON "travtrack_uploads"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_uploads_user_id_upload_id_key" ON "travtrack_uploads"("user_id", "upload_id");

-- CreateIndex
CREATE INDEX "travtrack_deleted_ranges_user_id_from_at_idx" ON "travtrack_deleted_ranges"("user_id", "from_at");

-- CreateIndex
CREATE INDEX "travtrack_privacy_zones_user_id_idx" ON "travtrack_privacy_zones"("user_id");

-- CreateIndex
CREATE INDEX "travtrack_gaps_user_id_from_at_idx" ON "travtrack_gaps"("user_id", "from_at");

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_gaps_user_id_device_id_from_at_reason_key" ON "travtrack_gaps"("user_id", "device_id", "from_at", "reason");

-- CreateIndex
CREATE UNIQUE INDEX "travtrack_share_snapshots_trip_id_key" ON "travtrack_share_snapshots"("trip_id");

-- AddForeignKey
ALTER TABLE "travtrack_points" ADD CONSTRAINT "travtrack_points_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_point_links" ADD CONSTRAINT "travtrack_point_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_point_links" ADD CONSTRAINT "travtrack_point_links_point_id_fkey" FOREIGN KEY ("point_id") REFERENCES "travtrack_points"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_uploads" ADD CONSTRAINT "travtrack_uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_deleted_ranges" ADD CONSTRAINT "travtrack_deleted_ranges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_privacy_zones" ADD CONSTRAINT "travtrack_privacy_zones_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_gaps" ADD CONSTRAINT "travtrack_gaps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_share_snapshots" ADD CONSTRAINT "travtrack_share_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_share_snapshots" ADD CONSTRAINT "travtrack_share_snapshots_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The closed vocabularies, held by the database (hand-appended; Prisma has no enum-less CHECK).
ALTER TABLE "travtrack_points" ADD CONSTRAINT "travtrack_points_purpose_check"
  CHECK ("purpose" IN ('everyday', 'flight', 'trip'));

ALTER TABLE "travtrack_point_links" ADD CONSTRAINT "travtrack_point_links_entry_kind_check"
  CHECK ("entry_kind" IN ('flight', 'trip'));

ALTER TABLE "travtrack_gaps" ADD CONSTRAINT "travtrack_gaps_reason_check"
  CHECK ("reason" IN ('zonesUnknown', 'recorderSilent', 'permission'));

ALTER TABLE "travtrack_gaps" ADD CONSTRAINT "travtrack_gaps_span_check"
  CHECK ("to_at" > "from_at");

ALTER TABLE "travtrack_deleted_ranges" ADD CONSTRAINT "travtrack_deleted_ranges_span_check"
  CHECK ("to_at" > "from_at");
