-- The guest door is removed (spec 2026-11-02 §7); remote plan members now ride a user connection.
-- Guest members never left the RC server: they are ended, not deleted, so documents and notices
-- keep the name of who wrote them. A later member bound to a connection is a different row.
UPDATE "travel_plan_members" SET "status" = 'revoked', "revoked_at" = COALESCE("revoked_at", now())
  WHERE "kind" = 'remote' AND "status" IN ('invited', 'active');

-- DropForeignKey
ALTER TABLE "travel_plan_guest_claims" DROP CONSTRAINT "travel_plan_guest_claims_member_id_fkey";

-- DropForeignKey
ALTER TABLE "travel_plan_guest_invites" DROP CONSTRAINT "travel_plan_guest_invites_member_id_fkey";

-- DropForeignKey
ALTER TABLE "travel_plan_guest_joins" DROP CONSTRAINT "travel_plan_guest_joins_invite_id_fkey";

-- DropForeignKey
ALTER TABLE "travel_plan_guest_joins" DROP CONSTRAINT "travel_plan_guest_joins_member_id_fkey";

-- DropForeignKey
ALTER TABLE "travel_plan_guest_sessions" DROP CONSTRAINT "travel_plan_guest_sessions_member_id_fkey";

-- DropIndex
DROP INDEX "travel_plan_members_plan_id_remote_origin_remote_subject_key";

-- AlterTable
ALTER TABLE "travel_plan_members" DROP COLUMN "remote_subject",
ADD COLUMN     "connection_id" TEXT;

-- DropTable
DROP TABLE "travel_plan_guest_claims";

-- DropTable
DROP TABLE "travel_plan_guest_invites";

-- DropTable
DROP TABLE "travel_plan_guest_joins";

-- DropTable
DROP TABLE "travel_plan_guest_sessions";

-- CreateTable
CREATE TABLE "remote_plan_memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner_display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'editor',
    "state" TEXT NOT NULL DEFAULT 'invited',
    "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "remote_plan_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connection_announcements" (
    "id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "peer_origin" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connection_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remote_plan_memberships_user_id_state_idx" ON "remote_plan_memberships"("user_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "remote_plan_memberships_connection_id_plan_id_key" ON "remote_plan_memberships"("connection_id", "plan_id");

-- CreateIndex
CREATE INDEX "connection_announcements_next_attempt_at_idx" ON "connection_announcements"("next_attempt_at");

-- CreateIndex
CREATE INDEX "connection_announcements_connection_id_idx" ON "connection_announcements"("connection_id");

-- CreateIndex
CREATE INDEX "travel_plan_members_connection_id_idx" ON "travel_plan_members"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "travel_plan_members_plan_id_connection_id_key" ON "travel_plan_members"("plan_id", "connection_id");

-- AddForeignKey
ALTER TABLE "travel_plan_members" ADD CONSTRAINT "travel_plan_members_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "remote_share_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_plan_memberships" ADD CONSTRAINT "remote_plan_memberships_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "remote_share_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connection_announcements" ADD CONSTRAINT "connection_announcements_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "remote_share_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "remote_plan_memberships" ADD CONSTRAINT "remote_plan_memberships_state_check"
  CHECK ("state" IN ('invited', 'active', 'declined', 'left', 'ended'));
