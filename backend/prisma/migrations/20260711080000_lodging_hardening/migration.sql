-- DropForeignKey
ALTER TABLE "lodging_memberships" DROP CONSTRAINT "lodging_memberships_chain_id_fkey";

-- DropIndex
DROP INDEX "lodging_stays_user_id_idx";

-- AlterTable
ALTER TABLE "lodging_memberships" DROP COLUMN "chain_id";

-- AlterTable
ALTER TABLE "lodging_stays" ALTER COLUMN "currency" SET NOT NULL;

-- Backfill before the NOT NULL flip. base_currency was added with
-- DEFAULT 'EUR' in the previous migration (20260711061740_lodging_domain),
-- so existing rows should already hold 'EUR' — but a NOT NULL flip on a
-- populated production table must never rely on that alone.
UPDATE "user_settings" SET "base_currency" = 'EUR' WHERE "base_currency" IS NULL;

-- AlterTable
ALTER TABLE "user_settings" ALTER COLUMN "base_currency" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "lodging_chains_name_key" ON "lodging_chains"("name");

-- CreateIndex
CREATE UNIQUE INDEX "lodging_memberships_user_id_program_name_key" ON "lodging_memberships"("user_id", "program_name");

-- CreateIndex
CREATE INDEX "lodging_stays_membership_id_idx" ON "lodging_stays"("membership_id");

-- CreateIndex
CREATE INDEX "lodgings_chain_id_idx" ON "lodgings"("chain_id");
