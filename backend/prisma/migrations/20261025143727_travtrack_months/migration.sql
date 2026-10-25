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

-- Backfill (TravTrack plan L3): every UTC day holding a TravTrack point gets a
-- dirty-day row, so the month projection (done bit 4, not set on any existing
-- row) derives the whole history once. Existing rows keep their version and
-- their other bits; `t` is a TIMESTAMP holding UTC.
INSERT INTO "travtrack_dirty_days" ("user_id", "day", "version", "done")
SELECT DISTINCT "user_id", "t"::date, 1, 0 FROM "travtrack_points"
ON CONFLICT ("user_id", "day") DO NOTHING;
