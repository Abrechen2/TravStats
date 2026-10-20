-- AlterTable
ALTER TABLE "trip_share_groups" ADD COLUMN     "federated_ref" TEXT,
ADD COLUMN     "home_origin" TEXT;

-- AlterTable
ALTER TABLE "trip_share_invites" ADD COLUMN     "trip_id" TEXT;

-- CreateTable
CREATE TABLE "trip_share_remote_members" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "remote_id" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'invited',
    "state_reason" TEXT,
    "state_since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offer" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_remote_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_share_peer_streams" (
    "group_id" TEXT NOT NULL,
    "peer_origin" TEXT NOT NULL,
    "last_sent_seq" INTEGER NOT NULL DEFAULT 0,
    "last_received_seq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "trip_share_peer_streams_pkey" PRIMARY KEY ("group_id","peer_origin")
);

-- CreateTable
CREATE TABLE "trip_share_inbound" (
    "peer_origin" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "group_ref" TEXT,
    "reply" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_inbound_pkey" PRIMARY KEY ("peer_origin","message_id")
);

-- CreateIndex
CREATE INDEX "trip_share_remote_members_remote_id_idx" ON "trip_share_remote_members"("remote_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_share_remote_members_group_id_remote_id_key" ON "trip_share_remote_members"("group_id", "remote_id");

-- CreateIndex
CREATE INDEX "trip_share_inbound_received_at_idx" ON "trip_share_inbound"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "trip_share_groups_home_ref_key" ON "trip_share_groups"("federated_ref") WHERE (home_origin IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "trip_share_groups_home_origin_federated_ref_key" ON "trip_share_groups"("home_origin", "federated_ref");

-- CreateIndex
CREATE INDEX "trip_share_invites_trip_id_idx" ON "trip_share_invites"("trip_id");

-- AddForeignKey
ALTER TABLE "trip_share_invites" ADD CONSTRAINT "trip_share_invites_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_remote_members" ADD CONSTRAINT "trip_share_remote_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "trip_share_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_remote_members" ADD CONSTRAINT "trip_share_remote_members_remote_id_fkey" FOREIGN KEY ("remote_id") REFERENCES "remote_share_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_peer_streams" ADD CONSTRAINT "trip_share_peer_streams_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "trip_share_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-added (spec 2026-10-20 F3, as `share_vocabulary_checks`): a remote member's state is one
-- of the vocabulary in `schemas/sharingRemote.ts` (REMOTE_MEMBER_STATES); shareVocabulary.test.ts
-- holds the two together. A group's wire ref and home travel together: a group with a home
-- elsewhere always knows its ref there. Sequence numbers never go below zero.
ALTER TABLE trip_share_remote_members ADD CONSTRAINT trip_share_remote_members_state_check CHECK (
  state IN ('invited', 'active', 'declined', 'unreachable', 'suspended', 'left', 'revoked')
);
ALTER TABLE trip_share_groups ADD CONSTRAINT trip_share_groups_home_ref_check CHECK (
  home_origin IS NULL OR federated_ref IS NOT NULL
);
ALTER TABLE trip_share_peer_streams ADD CONSTRAINT trip_share_peer_streams_seq_check CHECK (
  last_sent_seq >= 0 AND last_received_seq >= 0
);
