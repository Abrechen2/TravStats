-- Retention prunes only archives the backup schedule made (rc.29 review). Rows that exist
-- already stay unmarked on purpose: which of them were hand-made is unknown, and an archive
-- kept too long costs disk space while one deleted wrongly is gone.

-- AlterTable
ALTER TABLE "backups" ADD COLUMN     "scheduled" BOOLEAN NOT NULL DEFAULT false;
