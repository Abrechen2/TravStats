-- AlterTable
ALTER TABLE "cruises" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'ocean';

-- AlterTable
ALTER TABLE "ships" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'ocean';

-- CreateIndex
CREATE INDEX "ships_kind_idx" ON "ships"("kind");

-- #359 backfill: a cruise that starts AND ends at a river port (the port
-- catalogue tags those `river_<name>`, which the river distance calculator
-- already reads) was a river cruise. Everything else keeps the default.
UPDATE "cruises" AS c
SET "kind" = 'river'
FROM "ports" AS dep, "ports" AS arr
WHERE c."departure_port_id" = dep."id"
  AND c."arrival_port_id" = arr."id"
  AND dep."region" LIKE 'river\_%'
  AND arr."region" LIKE 'river\_%';
