-- AlterTable
ALTER TABLE "travtrack_derivation_state" ADD COLUMN     "zone_cells_overflow" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "zone_cells_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "travtrack_zone_cells" (
    "user_id" TEXT NOT NULL,
    "x" INTEGER NOT NULL,
    "y" INTEGER NOT NULL,
    "component" INTEGER NOT NULL,

    CONSTRAINT "travtrack_zone_cells_pkey" PRIMARY KEY ("user_id","x","y")
);

-- CreateIndex
CREATE INDEX "travtrack_zone_cells_user_id_component_idx" ON "travtrack_zone_cells"("user_id", "component");

-- AddForeignKey
ALTER TABLE "travtrack_zone_cells" ADD CONSTRAINT "travtrack_zone_cells_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
