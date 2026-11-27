-- AlterTable
ALTER TABLE "mail_intake_sources" ADD COLUMN     "fetch_from" TEXT NOT NULL DEFAULT 'now',
ADD COLUMN     "keep_unread" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "prefilter" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "processed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "removed_sender_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sender_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "removed_subject_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "subject_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "skipped_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "mail_intake_scans" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "since" TIMESTAMP(3),
    "before" TIMESTAMP(3),
    "uid_validity" TEXT,
    "cursor_uid" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_intake_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mail_intake_candidates" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "uid_validity" TEXT NOT NULL,
    "uid" INTEGER NOT NULL,
    "message_id" TEXT,
    "received_at" TIMESTAMP(3),
    "from_address" TEXT,
    "subject" TEXT,
    "brand" TEXT,
    "guessed_domain" TEXT,
    "match_hint" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_intake_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_scans_source_id_key" ON "mail_intake_scans"("source_id");

-- CreateIndex
CREATE INDEX "mail_intake_candidates_user_id_status_idx" ON "mail_intake_candidates"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mail_intake_candidates_source_id_uid_validity_uid_key" ON "mail_intake_candidates"("source_id", "uid_validity", "uid");

-- AddForeignKey
ALTER TABLE "mail_intake_scans" ADD CONSTRAINT "mail_intake_scans_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "mail_intake_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_scans" ADD CONSTRAINT "mail_intake_scans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_candidates" ADD CONSTRAINT "mail_intake_candidates_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "mail_intake_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mail_intake_candidates" ADD CONSTRAINT "mail_intake_candidates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A personal source that reads the INBOX keeps its mails unread from now on: the
-- invisible keyword marks what TravStats took, `\Seen` stays the user's own.
UPDATE "mail_intake_sources" SET "keep_unread" = true
WHERE "kind" = 'imap_folder' AND upper("folder") = 'INBOX';
