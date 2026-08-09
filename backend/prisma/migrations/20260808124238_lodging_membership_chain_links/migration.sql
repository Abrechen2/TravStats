-- CreateTable
CREATE TABLE "lodging_membership_chains" (
    "membership_id" TEXT NOT NULL,
    "chain_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_membership_chains_pkey" PRIMARY KEY ("membership_id","chain_id")
);

-- CreateIndex
CREATE INDEX "lodging_membership_chains_chain_id_idx" ON "lodging_membership_chains"("chain_id");

-- AddForeignKey
ALTER TABLE "lodging_membership_chains" ADD CONSTRAINT "lodging_membership_chains_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "lodging_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_membership_chains" ADD CONSTRAINT "lodging_membership_chains_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "lodging_chains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: reproduce the links the old STRING join produced, so no existing
-- membership loses its chain page on upgrade. This is the last time the two
-- names are compared as text — from here the link is by id, and a rebrand on
-- either side no longer breaks anything.
INSERT INTO "lodging_membership_chains" ("membership_id", "chain_id", "created_at")
SELECT m."id", c."id", CURRENT_TIMESTAMP
FROM "lodging_memberships" m
JOIN "lodging_chains" c ON c."loyalty_program" = m."program_name"
ON CONFLICT DO NOTHING;
