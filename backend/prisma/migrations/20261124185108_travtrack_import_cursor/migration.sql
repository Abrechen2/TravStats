-- AlterTable
ALTER TABLE "travtrack_imports" ADD COLUMN     "cursor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "file_sha256" CHAR(64);

-- A file import that stopped mid-way with points stored is `partial` (resumable
-- from `cursor`); `failed` is left for an import that stored nothing.
ALTER TABLE "travtrack_imports" DROP CONSTRAINT "travtrack_imports_status_check";
ALTER TABLE "travtrack_imports" ADD CONSTRAINT "travtrack_imports_status_check"
  CHECK ("status" IN ('running', 'succeeded', 'partial', 'failed', 'interrupted', 'cancelled'));
