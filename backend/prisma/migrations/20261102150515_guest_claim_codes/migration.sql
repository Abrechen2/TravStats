-- AlterTable
ALTER TABLE "travel_plan_guest_sessions" ADD COLUMN     "revoked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "travel_plan_guest_claims" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "travel_plan_guest_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "travel_plan_guest_claims_code_hash_key" ON "travel_plan_guest_claims"("code_hash");

-- CreateIndex
CREATE INDEX "travel_plan_guest_claims_member_id_idx" ON "travel_plan_guest_claims"("member_id");

-- CreateIndex
CREATE INDEX "travel_plan_guest_claims_expires_at_idx" ON "travel_plan_guest_claims"("expires_at");

-- AddForeignKey
ALTER TABLE "travel_plan_guest_claims" ADD CONSTRAINT "travel_plan_guest_claims_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "travel_plan_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
