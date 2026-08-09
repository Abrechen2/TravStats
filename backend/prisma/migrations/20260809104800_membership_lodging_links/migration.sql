-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "membership_opt_out" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "lodging_membership_lodgings" (
    "membership_id" TEXT NOT NULL,
    "lodging_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_membership_lodgings_pkey" PRIMARY KEY ("membership_id","lodging_id")
);

-- CreateIndex
CREATE INDEX "lodging_membership_lodgings_lodging_id_idx" ON "lodging_membership_lodgings"("lodging_id");

-- AddForeignKey
ALTER TABLE "lodging_membership_lodgings" ADD CONSTRAINT "lodging_membership_lodgings_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "lodging_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_membership_lodgings" ADD CONSTRAINT "lodging_membership_lodgings_lodging_id_fkey" FOREIGN KEY ("lodging_id") REFERENCES "lodgings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data step: existing `membership_id` values were the ANSWER; they are now an
-- OVERRIDE. Any stay whose stored card is exactly the one derivation will now
-- produce from its hotel's chain must be cleared, or every historic stay would
-- render as an explicit "abweichend" override on the day this ships.
--
-- Only the chain case is considered: the lodging link table is created empty by
-- this same migration, so no stay can yet derive through it. Stays whose stored
-- card does NOT cover their hotel's chain keep it — those are real deviations.
UPDATE "lodging_stays" AS s
SET "membership_id" = NULL
FROM "lodgings" AS l, "lodging_membership_chains" AS mc
WHERE s."lodging_id" = l."id"
  AND l."chain_id" IS NOT NULL
  AND s."membership_id" IS NOT NULL
  AND mc."membership_id" = s."membership_id"
  AND mc."chain_id" = l."chain_id";
