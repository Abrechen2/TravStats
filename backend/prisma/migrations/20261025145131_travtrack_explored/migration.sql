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

-- No backfill (Codex review of L1): every day holding a TravTrack point
-- already has a dirty-day row (ingest marks it; the country projection's
-- first run marked every point day), and the explored map's done bit (2) is
-- set on none of them, so the projection scheduler finds them on its own —
-- in its bounded ticks, with no whole-history scan at deploy and no country
-- bit cleared.
