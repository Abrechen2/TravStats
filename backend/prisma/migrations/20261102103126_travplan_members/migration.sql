-- AlterTable
ALTER TABLE "travel_plan_mutations" ADD COLUMN     "actor_member_id" TEXT,
ADD COLUMN     "summary" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "travel_plan_members" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "user_id" TEXT,
    "remote_origin" TEXT,
    "remote_subject" TEXT,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "status" TEXT NOT NULL DEFAULT 'invited',
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "shared_at" TIMESTAMP(3),

    CONSTRAINT "travel_plan_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_plan_notices" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "recipient_id" TEXT NOT NULL,
    "mutation_id" TEXT NOT NULL,
    "actor_member_id" TEXT,
    "actor_name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "travel_plan_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "travel_plan_members_user_id_status_idx" ON "travel_plan_members"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "travel_plan_members_plan_id_user_id_key" ON "travel_plan_members"("plan_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "travel_plan_members_plan_id_remote_origin_remote_subject_key" ON "travel_plan_members"("plan_id", "remote_origin", "remote_subject");

-- CreateIndex
CREATE INDEX "travel_plan_notices_recipient_id_read_at_idx" ON "travel_plan_notices"("recipient_id", "read_at");

-- AddForeignKey
ALTER TABLE "travel_plan_members" ADD CONSTRAINT "travel_plan_members_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "travel_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_members" ADD CONSTRAINT "travel_plan_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_notices" ADD CONSTRAINT "travel_plan_notices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "travel_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_plan_notices" ADD CONSTRAINT "travel_plan_notices_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "travel_plan_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed vocabularies (Prisma cannot declare CHECKs; the services parse the same sets).
ALTER TABLE "travel_plan_members"
  ADD CONSTRAINT "travel_plan_members_kind_check" CHECK ("kind" IN ('owner', 'local', 'remote')),
  ADD CONSTRAINT "travel_plan_members_role_check" CHECK ("role" IN ('owner', 'editor')),
  ADD CONSTRAINT "travel_plan_members_status_check"
    CHECK ("status" IN ('invited', 'active', 'left', 'revoked'));

-- Every existing plan gets its owner as the first member, so attribution and
-- "brings it" labels never meet a plan without one.
INSERT INTO "travel_plan_members"
  ("id", "plan_id", "kind", "user_id", "display_name", "role", "status", "joined_at")
SELECT gen_random_uuid()::text, p."id", 'owner', t."user_id",
       COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u."first_name", u."last_name")), ''), u."username"),
       'owner', 'active', p."created_at"
FROM "travel_plans" p
JOIN "trips" t ON t."id" = p."trip_id"
JOIN "users" u ON u."id" = t."user_id"
ON CONFLICT DO NOTHING;
