-- One table for every loyalty programme (owner, 2026-09-25): hotel cards,
-- frequent-flyer cards and cruise-line clubs.
--
-- The existing lodging table is RENAMED, not copied. A rename keeps every row,
-- every id and therefore every foreign key that points at one — the stays'
-- `membership_id` and both link tables follow the table without a single row
-- being rewritten. Prisma's own diff would have dropped the table and created a
-- new one, which is exactly the data loss this file exists to avoid.

ALTER TABLE "lodging_memberships" RENAME TO "loyalty_memberships";
ALTER TABLE "loyalty_memberships" RENAME CONSTRAINT "lodging_memberships_pkey" TO "loyalty_memberships_pkey";
ALTER TABLE "loyalty_memberships" RENAME CONSTRAINT "lodging_memberships_user_id_fkey" TO "loyalty_memberships_user_id_fkey";
ALTER INDEX "lodging_memberships_user_id_idx" RENAME TO "loyalty_memberships_user_id_idx";

-- Every row that exists is a hotel card, so the default IS the backfill: the
-- column arrives filled with 'lodging' for all of them.
ALTER TABLE "loyalty_memberships" ADD COLUMN "domain" TEXT NOT NULL DEFAULT 'lodging';
ALTER TABLE "loyalty_memberships" ADD COLUMN "notes" TEXT;
ALTER TABLE "loyalty_memberships" ADD COLUMN "airline_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "loyalty_memberships" ADD COLUMN "cruise_lines" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The vocabulary of `shared/loyaltyDomains.ts`. Prisma cannot express it; the
-- write path validates it too, and this is the backstop for everything else.
ALTER TABLE "loyalty_memberships" ADD CONSTRAINT "loyalty_memberships_domain_check"
  CHECK ("domain" IN ('flight', 'cruise', 'lodging'));

-- One programme name per user PER DOMAIN. Existing rows were unique per user,
-- so they are unique per (user, 'lodging') as well and this cannot fail.
DROP INDEX "lodging_memberships_user_id_program_name_key";
CREATE UNIQUE INDEX "loyalty_memberships_user_id_domain_program_name_key" ON "loyalty_memberships"("user_id", "domain", "program_name");

-- Dated status history (loyalty-status-history-dated).
CREATE TABLE "loyalty_tier_periods" (
    "id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_tier_periods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loyalty_tier_periods_membership_id_idx" ON "loyalty_tier_periods"("membership_id");

ALTER TABLE "loyalty_tier_periods" ADD CONSTRAINT "loyalty_tier_periods_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "loyalty_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
