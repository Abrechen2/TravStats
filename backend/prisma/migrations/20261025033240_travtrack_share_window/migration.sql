-- AlterTable
ALTER TABLE "travtrack_share_snapshots" ADD COLUMN     "home_circles" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "shared_from" TIMESTAMP(3),
ADD COLUMN     "shared_until" TIMESTAMP(3);
