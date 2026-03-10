-- AlterTable
ALTER TABLE "flights" ADD COLUMN "companions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
