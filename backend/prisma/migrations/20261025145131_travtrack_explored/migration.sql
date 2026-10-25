-- AlterTable
ALTER TABLE "travtrack_derivation_state" ADD COLUMN     "zone_cells_overflow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zone_cells_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "travtrack_explored_cells" (
    "user_id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,

    CONSTRAINT "travtrack_explored_cells_pkey" PRIMARY KEY ("user_id","day","x","y")
);

-- CreateTable
CREATE TABLE "travtrack_zone_cells" (
    "user_id" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "component" INTEGER NOT NULL,

    CONSTRAINT "travtrack_zone_cells_pkey" PRIMARY KEY ("user_id","x","y")
);

-- CreateIndex
CREATE INDEX "travtrack_explored_cells_user_id_x_y_idx" ON "travtrack_explored_cells"("user_id", "x", "y");

-- CreateIndex
CREATE INDEX "travtrack_zone_cells_user_id_component_idx" ON "travtrack_zone_cells"("user_id", "component");

-- AddForeignKey
ALTER TABLE "travtrack_explored_cells" ADD CONSTRAINT "travtrack_explored_cells_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travtrack_zone_cells" ADD CONSTRAINT "travtrack_zone_cells_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (TravTrack plan L1): every UTC day holding a TravTrack point gets a
-- dirty-day row, so the explored projection (done bit 2, not set on any
-- existing row) derives the whole history once. Existing rows keep their
-- version and their other bits; `t` is a TIMESTAMP holding UTC.
INSERT INTO "travtrack_dirty_days" ("user_id", "day", "version", "done")
SELECT DISTINCT "user_id", "t"::date, 1, 0 FROM "travtrack_points"
ON CONFLICT ("user_id", "day") DO NOTHING;
