/*
  Warnings:

  - A unique constraint covering the columns `[requester_id,remote_target_id]` on the table `share_consents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[remote_requester_id,target_id]` on the table `share_consents` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "share_consents" ADD COLUMN     "remote_requester_id" TEXT,
ADD COLUMN     "remote_target_id" TEXT,
ALTER COLUMN "requester_id" DROP NOT NULL,
ALTER COLUMN "target_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "remote_share_accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "local_channel" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remote_share_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_share_invites" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remote_share_accounts_user_id_idx" ON "remote_share_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "remote_share_accounts_origin_channel_key" ON "remote_share_accounts"("origin", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "remote_share_accounts_origin_local_channel_key" ON "remote_share_accounts"("origin", "local_channel");

-- CreateIndex
CREATE UNIQUE INDEX "trip_share_invites_hash_key" ON "trip_share_invites"("hash");

-- CreateIndex
CREATE INDEX "trip_share_invites_user_id_idx" ON "trip_share_invites"("user_id");

-- CreateIndex
CREATE INDEX "share_consents_remote_target_id_idx" ON "share_consents"("remote_target_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_consents_requester_id_remote_target_id_key" ON "share_consents"("requester_id", "remote_target_id");

-- CreateIndex
CREATE UNIQUE INDEX "share_consents_remote_requester_id_target_id_key" ON "share_consents"("remote_requester_id", "target_id");

-- AddForeignKey
ALTER TABLE "share_consents" ADD CONSTRAINT "share_consents_remote_requester_id_fkey" FOREIGN KEY ("remote_requester_id") REFERENCES "remote_share_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_consents" ADD CONSTRAINT "share_consents_remote_target_id_fkey" FOREIGN KEY ("remote_target_id") REFERENCES "remote_share_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "remote_share_accounts" ADD CONSTRAINT "remote_share_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_invites" ADD CONSTRAINT "trip_share_invites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added (spec 2026-10-20 F3, as `share_vocabulary_checks`): each side of a consent is
-- exactly one of a local user or a remote account, and at least one side is local — a consent
-- between two people on other servers is not this server's to hold. Existing rows are all
-- user-to-user, so they satisfy it; shareVocabulary.test.ts holds the constraint in place.
ALTER TABLE share_consents ADD CONSTRAINT share_consents_party_check CHECK (
  (requester_id IS NULL) <> (remote_requester_id IS NULL)
  AND (target_id IS NULL) <> (remote_target_id IS NULL)
  AND (requester_id IS NOT NULL OR target_id IS NOT NULL)
);
