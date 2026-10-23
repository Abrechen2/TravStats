-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "transit_mode" TEXT NOT NULL DEFAULT 'rail';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "rail_import_bus" TEXT NOT NULL DEFAULT 'skip',
ADD COLUMN     "rail_import_local_transit" TEXT NOT NULL DEFAULT 'skip';

-- CreateIndex
CREATE INDEX "rail_stations_db_id_idx" ON "rail_stations"("db_id");
