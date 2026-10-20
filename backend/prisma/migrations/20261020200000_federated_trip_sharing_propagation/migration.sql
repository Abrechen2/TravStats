-- AlterTable
ALTER TABLE "share_notices" ADD COLUMN     "remote_actor_id" TEXT;

-- CreateTable
CREATE TABLE "trip_share_outbox" (
    "id" TEXT NOT NULL,
    "position" SERIAL NOT NULL,
    "group_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "peer_origin" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "label" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failing_since" TIMESTAMP(3),
    "last_error" TEXT,
    "parked_at" TIMESTAMP(3),
    "parked_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trip_share_outbox_position_key" ON "trip_share_outbox"("position");

-- CreateIndex
CREATE INDEX "trip_share_outbox_group_id_peer_origin_position_idx" ON "trip_share_outbox"("group_id", "peer_origin", "position");

-- CreateIndex
CREATE INDEX "trip_share_outbox_member_id_idx" ON "trip_share_outbox"("member_id");

-- CreateIndex
CREATE INDEX "trip_share_outbox_next_attempt_at_idx" ON "trip_share_outbox"("next_attempt_at");

-- CreateIndex
CREATE INDEX "share_notices_remote_actor_id_idx" ON "share_notices"("remote_actor_id");

-- AddForeignKey
ALTER TABLE "trip_share_outbox" ADD CONSTRAINT "trip_share_outbox_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "trip_share_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_outbox" ADD CONSTRAINT "trip_share_outbox_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "trip_share_remote_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_notices" ADD CONSTRAINT "share_notices_remote_actor_id_fkey" FOREIGN KEY ("remote_actor_id") REFERENCES "remote_share_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-added (spec 2026-10-20 F3/F6/F7, as `share_vocabulary_checks`): a notice names at most one
-- actor — an account here or a person on another server; the notice kinds gain `conflict`
-- (schemas/sharing.ts SHARE_NOTICE_KINDS; shareVocabulary.test.ts holds the two together); an
-- outbox row is one of the propagation messages and never counts its attempts below zero.
ALTER TABLE share_notices ADD CONSTRAINT share_notices_actor_check CHECK (
  actor_id IS NULL OR remote_actor_id IS NULL
);
ALTER TABLE share_notices DROP CONSTRAINT share_notices_kind_check;
ALTER TABLE share_notices ADD CONSTRAINT share_notices_kind_check
  CHECK (kind IN ('shared', 'created', 'updated', 'deleted', 'left', 'conflict'));
ALTER TABLE trip_share_outbox ADD CONSTRAINT trip_share_outbox_kind_check CHECK (
  kind IN ('entries', 'fact-update', 'entry-create', 'entry-removed')
);
ALTER TABLE trip_share_outbox ADD CONSTRAINT trip_share_outbox_attempts_check CHECK (
  attempts >= 0
);
