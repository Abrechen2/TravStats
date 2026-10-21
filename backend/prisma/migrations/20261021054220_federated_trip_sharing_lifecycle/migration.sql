-- AlterTable (hand-edited: a member that already exists gets its roster ref here, then the
-- column is required; Prisma mints it for every row created after this).
ALTER TABLE "trip_share_remote_members" ADD COLUMN     "local_ref" TEXT,
ADD COLUMN     "roster_ref" TEXT;
UPDATE "trip_share_remote_members" SET "roster_ref" = gen_random_uuid()::text WHERE "roster_ref" IS NULL;
ALTER TABLE "trip_share_remote_members" ALTER COLUMN "roster_ref" SET NOT NULL;

-- CreateTable
CREATE TABLE "trip_share_roster_entries" (
    "group_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_roster_entries_pkey" PRIMARY KEY ("group_id","ref")
);

-- CreateTable
CREATE TABLE "trip_share_roster_consents" (
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_roster_consents_pkey" PRIMARY KEY ("group_id","user_id","ref")
);

-- CreateIndex
CREATE INDEX "trip_share_roster_consents_user_id_idx" ON "trip_share_roster_consents"("user_id");

-- AddForeignKey
ALTER TABLE "trip_share_roster_entries" ADD CONSTRAINT "trip_share_roster_entries_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "trip_share_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_roster_consents" ADD CONSTRAINT "trip_share_roster_consents_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "trip_share_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_roster_consents" ADD CONSTRAINT "trip_share_roster_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-added (spec 2026-10-20 F-S4e, as `share_vocabulary_checks`): a roster consent is a yes or
-- a no (no row = not asked yet); the outbox carries the lifecycle messages too; a notice can be a
-- spoke member's request to the home to offer the trip to someone else. `shareVocabulary.test.ts`
-- holds each list against its Zod twin.
ALTER TABLE trip_share_roster_consents ADD CONSTRAINT trip_share_roster_consents_status_check
  CHECK (status IN ('accepted', 'declined'));
ALTER TABLE trip_share_outbox DROP CONSTRAINT trip_share_outbox_kind_check;
ALTER TABLE trip_share_outbox ADD CONSTRAINT trip_share_outbox_kind_check CHECK (
  kind IN ('entries', 'fact-update', 'entry-create', 'entry-removed', 'roster', 'leave', 'revoke')
);
ALTER TABLE share_notices DROP CONSTRAINT share_notices_kind_check;
ALTER TABLE share_notices ADD CONSTRAINT share_notices_kind_check
  CHECK (kind IN ('shared', 'created', 'updated', 'deleted', 'left', 'conflict', 'add-request'));
