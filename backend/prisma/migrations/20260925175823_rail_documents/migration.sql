-- A rail journey can hold documents, as a flight or a cruise can (spec
-- 2026-09-25-rail-domain, phase 2b): the ticket files with its journey before
-- any parser exists for it.

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "rail_journey_id" TEXT;

-- CreateIndex
CREATE INDEX "documents_rail_journey_id_idx" ON "documents"("rail_journey_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_rail_journey_id_fkey" FOREIGN KEY ("rail_journey_id") REFERENCES "rail_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The single-owner rule gains the sixth owner. Prisma cannot express a CHECK;
-- the application enforces the same rule before it writes
-- (services/documents/documentService.ts).
ALTER TABLE "documents" DROP CONSTRAINT "documents_single_owner_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id") <= 1
);
