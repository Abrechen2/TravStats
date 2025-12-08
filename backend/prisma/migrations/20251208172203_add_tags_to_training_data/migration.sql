-- AlterTable
ALTER TABLE "training_data" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
