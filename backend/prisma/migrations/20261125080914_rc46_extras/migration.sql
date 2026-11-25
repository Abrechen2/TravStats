-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "ai_suggestion_help_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "map_matching_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "map_matching_engine" TEXT,
ADD COLUMN     "map_matching_url" TEXT;

-- AlterTable
ALTER TABLE "trip_routes" ADD COLUMN     "track_from_day" DATE,
ADD COLUMN     "track_to_day" DATE;

-- CreateTable
CREATE TABLE "travtrack_cleanups" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "from_ms" BIGINT,
    "until_ms" BIGINT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "geometry" JSONB,
    "confidence" DOUBLE PRECISION,
    "provider" TEXT,
    "point_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travtrack_cleanups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "travtrack_cleanups_user_id_kind_idx" ON "travtrack_cleanups"("user_id", "kind");

-- AddForeignKey
ALTER TABLE "travtrack_cleanups" ADD CONSTRAINT "travtrack_cleanups_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
