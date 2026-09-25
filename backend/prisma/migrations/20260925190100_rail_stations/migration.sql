-- Trigram search over station names (the rail station picker). Contrib
-- extension, shipped by the postgis image like unaccent; idempotent.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "rail_db_rest_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rail_transitous_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "arr_station_id" INTEGER,
ADD COLUMN     "dep_station_id" INTEGER;

-- CreateTable
CREATE TABLE "rail_stations" (
    "id" SERIAL NOT NULL,
    "source_id" TEXT,
    "name" TEXT NOT NULL,
    "search_name" TEXT NOT NULL,
    "uic" TEXT,
    "db_id" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "country" TEXT,
    "timezone" TEXT,
    "parent_source_id" TEXT,
    "is_user_added" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "rail_stations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rail_stations_source_id_key" ON "rail_stations"("source_id");

-- CreateIndex
CREATE INDEX "rail_stations_uic_idx" ON "rail_stations"("uic");

-- CreateIndex
CREATE INDEX "rail_stations_search_name_idx" ON "rail_stations" USING GIN ("search_name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "rail_journeys_dep_station_id_idx" ON "rail_journeys"("dep_station_id");

-- CreateIndex
CREATE INDEX "rail_journeys_arr_station_id_idx" ON "rail_journeys"("arr_station_id");

-- AddForeignKey
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_dep_station_id_fkey" FOREIGN KEY ("dep_station_id") REFERENCES "rail_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_arr_station_id_fkey" FOREIGN KEY ("arr_station_id") REFERENCES "rail_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
