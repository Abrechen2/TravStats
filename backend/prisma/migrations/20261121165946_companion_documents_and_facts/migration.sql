-- AlterTable
ALTER TABLE "bus_journey_companions" ADD COLUMN     "booking_reference" TEXT,
ADD COLUMN     "facts_source" TEXT,
ADD COLUMN     "loyalty_number" TEXT,
ADD COLUMN     "seat_class" TEXT,
ADD COLUMN     "seat_number" TEXT,
ADD COLUMN     "ticket_number" TEXT;

-- AlterTable
ALTER TABLE "cruise_companions" ADD COLUMN     "booking_reference" TEXT,
ADD COLUMN     "cabin" TEXT,
ADD COLUMN     "facts_source" TEXT,
ADD COLUMN     "loyalty_number" TEXT;

-- AlterTable
ALTER TABLE "document_links" ADD COLUMN     "companion_id" TEXT,
ADD COLUMN     "companion_source" TEXT;

-- AlterTable
ALTER TABLE "ferry_journey_companions" ADD COLUMN     "booking_reference" TEXT,
ADD COLUMN     "facts_source" TEXT,
ADD COLUMN     "loyalty_number" TEXT,
ADD COLUMN     "seat_class" TEXT,
ADD COLUMN     "seat_number" TEXT,
ADD COLUMN     "ticket_number" TEXT;

-- AlterTable
ALTER TABLE "flight_companions" ADD COLUMN     "booking_reference" TEXT,
ADD COLUMN     "facts_source" TEXT,
ADD COLUMN     "loyalty_number" TEXT,
ADD COLUMN     "seat_class" TEXT,
ADD COLUMN     "seat_number" TEXT,
ADD COLUMN     "ticket_number" TEXT;

-- AlterTable
ALTER TABLE "rail_journey_companions" ADD COLUMN     "booking_reference" TEXT,
ADD COLUMN     "facts_source" TEXT,
ADD COLUMN     "loyalty_number" TEXT,
ADD COLUMN     "seat_class" TEXT,
ADD COLUMN     "seat_number" TEXT,
ADD COLUMN     "ticket_number" TEXT;

-- AlterTable
ALTER TABLE "rental_booking_companions" ADD COLUMN     "booking_reference" TEXT,
ADD COLUMN     "facts_source" TEXT,
ADD COLUMN     "is_driver" BOOLEAN,
ADD COLUMN     "loyalty_number" TEXT;

-- CreateTable
CREATE TABLE "lodging_stay_companions" (
    "lodging_stay_id" TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "booking_reference" TEXT,
    "loyalty_number" TEXT,
    "facts_source" TEXT,

    CONSTRAINT "lodging_stay_companions_pkey" PRIMARY KEY ("lodging_stay_id","companion_id")
);

-- CreateIndex
CREATE INDEX "lodging_stay_companions_companion_id_idx" ON "lodging_stay_companions"("companion_id");

-- CreateIndex
CREATE INDEX "document_links_companion_id_idx" ON "document_links"("companion_id");

-- AddForeignKey
ALTER TABLE "lodging_stay_companions" ADD CONSTRAINT "lodging_stay_companions_lodging_stay_id_fkey" FOREIGN KEY ("lodging_stay_id") REFERENCES "lodging_stays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_stay_companions" ADD CONSTRAINT "lodging_stay_companions_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Closed vocabularies, as document_links_role_check / _provenance_check.
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_companion_source_check"
  CHECK ("companion_source" IS NULL OR "companion_source" IN ('user', 'auto'));
ALTER TABLE "flight_companions" ADD CONSTRAINT "flight_companions_facts_source_check"
  CHECK ("facts_source" IS NULL OR "facts_source" IN ('user', 'auto'));
ALTER TABLE "rail_journey_companions" ADD CONSTRAINT "rail_journey_companions_facts_source_check"
  CHECK ("facts_source" IS NULL OR "facts_source" IN ('user', 'auto'));
ALTER TABLE "bus_journey_companions" ADD CONSTRAINT "bus_journey_companions_facts_source_check"
  CHECK ("facts_source" IS NULL OR "facts_source" IN ('user', 'auto'));
ALTER TABLE "ferry_journey_companions" ADD CONSTRAINT "ferry_journey_companions_facts_source_check"
  CHECK ("facts_source" IS NULL OR "facts_source" IN ('user', 'auto'));
ALTER TABLE "cruise_companions" ADD CONSTRAINT "cruise_companions_facts_source_check"
  CHECK ("facts_source" IS NULL OR "facts_source" IN ('user', 'auto'));
ALTER TABLE "rental_booking_companions" ADD CONSTRAINT "rental_booking_companions_facts_source_check"
  CHECK ("facts_source" IS NULL OR "facts_source" IN ('user', 'auto'));
ALTER TABLE "lodging_stay_companions" ADD CONSTRAINT "lodging_stay_companions_facts_source_check"
  CHECK ("facts_source" IS NULL OR "facts_source" IN ('user', 'auto'));
