-- Per-user hotel chains (owner decision 2026-09-25): the seeded catalogue
-- stays global (user_id NULL); a chain a user creates belongs to that user.

-- DropIndex
DROP INDEX "lodging_chains_name_key";

-- AlterTable
ALTER TABLE "lodging_chains" ADD COLUMN     "user_id" TEXT;

-- Backfill: hand every user-created chain to the ONE account that uses it.
--
-- There is no creator column to read, so "who created it" is derived from who
-- references it — their lodgings and their membership links. A chain used by
-- exactly one account can only have come from that account's own add or
-- import, and moving it loses nobody anything. A chain used by several
-- accounts, or by none, cannot be attributed: it stays in the catalogue, where
-- it was visible to everyone before this migration and still is. Seeded rows
-- (is_user_added = false) are the catalogue by definition and are not touched.
WITH users_per_chain AS (
  SELECT chain_id, user_id FROM "lodgings" WHERE chain_id IS NOT NULL
  UNION
  SELECT lmc.chain_id, lm.user_id
  FROM "lodging_membership_chains" lmc
  JOIN "lodging_memberships" lm ON lm.id = lmc.membership_id
),
sole_user AS (
  SELECT chain_id, MIN(user_id) AS user_id
  FROM users_per_chain
  GROUP BY chain_id
  HAVING COUNT(DISTINCT user_id) = 1
)
UPDATE "lodging_chains" c
SET user_id = s.user_id
FROM sole_user s
WHERE c.id = s.chain_id AND c.is_user_added = true;

-- CreateIndex
CREATE INDEX "lodging_chains_user_id_idx" ON "lodging_chains"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lodging_chains_user_id_name_key" ON "lodging_chains"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "lodging_chains_catalogue_name_key" ON "lodging_chains"("name") WHERE (user_id IS NULL);

-- AddForeignKey
ALTER TABLE "lodging_chains" ADD CONSTRAINT "lodging_chains_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
