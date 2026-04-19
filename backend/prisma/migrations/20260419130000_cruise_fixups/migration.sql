-- AlterTable
ALTER TABLE "cruises" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- DropIndex
DROP INDEX IF EXISTS "ports_unlocode_idx";

-- DropIndex
DROP INDEX IF EXISTS "ships_imo_idx";

-- CreateIndex
CREATE INDEX "cruises_booking_id_idx" ON "cruises"("booking_id");
