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
--
-- The deriver resolves by IDENTITY, not existence: among every membership of
-- the same user that covers the hotel's chain, it picks the one with the
-- smallest (created_at, id) — id breaks a created_at tie
-- (shared/membershipDerivation.ts `oldest()`). A stay's stored membership_id
-- is safe to clear ONLY when it IS that unique minimum; otherwise clearing it
-- would silently swap the stay onto a different card than the one it was
-- saved with (e.g. two memberships on one chain: newer stored, older
-- unrelated -> derivation would return the older one, not the stored one).
-- The NOT EXISTS guard below rejects any stay where some OTHER same-user
-- membership on the same chain ties-or-beats the stored one under that exact
-- ordering, leaving it untouched (a kept override is cosmetic; a wrongly
-- cleared one changes behaviour).
UPDATE "lodging_stays" AS s
SET "membership_id" = NULL
FROM "lodgings" AS l, "lodging_membership_chains" AS mc, "lodging_memberships" AS m
WHERE s."lodging_id" = l."id"
  AND l."chain_id" IS NOT NULL
  AND s."membership_id" IS NOT NULL
  AND mc."membership_id" = s."membership_id"
  AND mc."chain_id" = l."chain_id"
  AND m."id" = s."membership_id"
  AND NOT EXISTS (
    SELECT 1
    FROM "lodging_membership_chains" AS mc2
    JOIN "lodging_memberships" AS m2 ON m2."id" = mc2."membership_id"
    WHERE mc2."chain_id" = l."chain_id"
      AND m2."user_id" = m."user_id"
      AND m2."id" <> m."id"
      AND (
        m2."created_at" < m."created_at"
        OR (m2."created_at" = m."created_at" AND m2."id" < m."id")
      )
  );
