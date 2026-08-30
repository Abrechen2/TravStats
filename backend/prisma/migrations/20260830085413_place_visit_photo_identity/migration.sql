-- AlterTable
ALTER TABLE "place_visit_photos" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "taken_at" TIMESTAMP(3);
