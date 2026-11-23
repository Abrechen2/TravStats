-- AlterTable
ALTER TABLE "travtrack_dirty_days" ADD COLUMN     "visits_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "visits_retry_after" TIMESTAMPTZ(6),
ADD COLUMN     "visits_waiting" INTEGER NOT NULL DEFAULT 0;
