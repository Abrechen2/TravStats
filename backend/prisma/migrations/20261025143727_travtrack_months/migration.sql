-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "travtrack_city_lookup" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "travtrack_month_values" (
    "user_id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "km_ground" DOUBLE PRECISION NOT NULL,
    "countries" TEXT[],
    "cities" JSONB,
    "days_with_data" INTEGER NOT NULL,
    "days_paused" INTEGER NOT NULL,
    "algorithm" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travtrack_month_values_pkey" PRIMARY KEY ("user_id","month")
);

-- CreateTable
CREATE TABLE "geo_city_cache" (
    "cell" TEXT NOT NULL,
    "name" TEXT,
    "country_code" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "geo_city_cache_pkey" PRIMARY KEY ("cell")
);

-- AddForeignKey
ALTER TABLE "travtrack_month_values" ADD CONSTRAINT "travtrack_month_values_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No backfill scan (Codex review of L3): the month projection is discovered
-- by the scheduler. Every UTC day holding a TravTrack point already has its
-- `travtrack_dirty_days` row — each store marks its day, and the L1 migration
-- (travtrack_explored) backfilled the older ones — and no existing row has done bit 4
-- set, so every such day is owed to the months without touching another bit.
