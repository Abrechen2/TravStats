-- The dated status history goes (owner, 2026-09-26, on the tester's word:
-- "Ich brauche keine Historie"). A card keeps ONE status, `tier`, the one it
-- holds today.
--
-- The history lived only in the 2.7 betas, and a user may have typed the
-- current status into it without also filling the card's own field. Before
-- the table is dropped, such a card takes over the status its history says it
-- still holds: a period with no end, or one that ends today or later. The
-- latest such period wins (then the most recently entered one). A card whose
-- history has only ended periods keeps its empty status — an expired status
-- is not a current one, and inventing one would be worse than asking. A card
-- that already names a status keeps it: that field was the user's own answer
-- to "what do you hold now".
--
-- Nothing else is lost: the memberships, their chain and hotel links and every
-- stay that names a card are untouched.

UPDATE "loyalty_memberships" m
SET "tier" = held."tier"
FROM (
  SELECT DISTINCT ON (p."membership_id") p."membership_id", p."tier"
  FROM "loyalty_tier_periods" p
  WHERE p."valid_until" IS NULL OR p."valid_until" >= CURRENT_DATE
  ORDER BY p."membership_id", p."valid_from" DESC, p."created_at" DESC, p."id" DESC
) AS held
WHERE m."id" = held."membership_id"
  AND (m."tier" IS NULL OR btrim(m."tier") = '');

-- DropForeignKey
ALTER TABLE "loyalty_tier_periods" DROP CONSTRAINT "loyalty_tier_periods_membership_id_fkey";

-- DropTable
DROP TABLE "loyalty_tier_periods";
