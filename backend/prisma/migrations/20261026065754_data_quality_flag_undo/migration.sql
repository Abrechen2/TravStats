-- AlterTable
ALTER TABLE "data_quality_flags" ADD COLUMN     "resolution" JSONB,
ADD COLUMN     "undo_until" TIMESTAMP(3);
