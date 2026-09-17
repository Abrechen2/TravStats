-- forgejo#50: the statistics ETag fingerprints each table a stats page reads by
-- (row count, max(updated_at)). These three were the only ones without the column.
-- Existing rows get the migration time, which is correct: the first request after
-- the deploy sees a new fingerprint and recomputes once.

-- AlterTable
ALTER TABLE "cruise_stops" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "user_achievements" ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
