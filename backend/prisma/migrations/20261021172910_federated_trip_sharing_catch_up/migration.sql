-- CreateTable
CREATE TABLE "trip_share_withheld" (
    "group_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entry_key" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "held" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_withheld_pkey" PRIMARY KEY ("group_id","user_id","entry_key","field","ref")
);

-- CreateIndex
CREATE INDEX "trip_share_withheld_user_id_idx" ON "trip_share_withheld"("user_id");

-- AddForeignKey
ALTER TABLE "trip_share_withheld" ADD CONSTRAINT "trip_share_withheld_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "trip_share_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_withheld" ADD CONSTRAINT "trip_share_withheld_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added (spec 2026-10-20, Q4/Q5 catch-up): the outbox carries a spoke's resync request and
-- the push of its own entries after a restore. `shareVocabulary.test.ts` holds the list against
-- `OUTBOX_KINDS`.
ALTER TABLE trip_share_outbox DROP CONSTRAINT trip_share_outbox_kind_check;
ALTER TABLE trip_share_outbox ADD CONSTRAINT trip_share_outbox_kind_check CHECK (
  kind IN ('entries', 'fact-update', 'entry-create', 'entry-removed', 'roster', 'leave', 'revoke', 'resync', 'entries-up')
);
