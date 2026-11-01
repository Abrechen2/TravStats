-- Public single-entry share links for a cruise, a lodging stay and a place visit (forgejo#405). Additive: three nullable, cascading references.
-- AlterTable
ALTER TABLE "public_share_links" ADD COLUMN     "cruise_id" TEXT,
ADD COLUMN     "lodging_stay_id" TEXT,
ADD COLUMN     "place_visit_id" TEXT;

-- CreateIndex
CREATE INDEX "public_share_links_cruise_id_idx" ON "public_share_links"("cruise_id");

-- CreateIndex
CREATE INDEX "public_share_links_lodging_stay_id_idx" ON "public_share_links"("lodging_stay_id");

-- CreateIndex
CREATE INDEX "public_share_links_place_visit_id_idx" ON "public_share_links"("place_visit_id");

-- AddForeignKey
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_lodging_stay_id_fkey" FOREIGN KEY ("lodging_stay_id") REFERENCES "lodging_stays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_share_links" ADD CONSTRAINT "public_share_links_place_visit_id_fkey" FOREIGN KEY ("place_visit_id") REFERENCES "place_visits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

