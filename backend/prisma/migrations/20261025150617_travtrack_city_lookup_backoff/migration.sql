-- AlterTable
ALTER TABLE "travtrack_derivation_state" ADD COLUMN     "city_lookup_failures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "city_lookup_retry_after" TIMESTAMP(3);
