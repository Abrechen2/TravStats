-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "summary_entry_count" INTEGER,
ADD COLUMN     "summary_generated_at" TIMESTAMP(3),
ADD COLUMN     "summary_source" TEXT;
