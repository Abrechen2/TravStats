-- Rail loyalty programmes (forgejo#132 item 23): a BahnBonus-style card covers
-- the rides whose operator it lists, as a cruise card covers its lines.

-- AlterTable
ALTER TABLE "loyalty_memberships" ADD COLUMN     "rail_operators" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- The vocabulary of `LOYALTY_DOMAINS` (shared/domains.ts) widens by one. Prisma
-- cannot express the CHECK, so this half is written by hand; every existing
-- row is flight, cruise or lodging and satisfies the wider constraint.
ALTER TABLE "loyalty_memberships" DROP CONSTRAINT "loyalty_memberships_domain_check";
ALTER TABLE "loyalty_memberships" ADD CONSTRAINT "loyalty_memberships_domain_check"
  CHECK ("domain" IN ('flight', 'cruise', 'lodging', 'rail'));
