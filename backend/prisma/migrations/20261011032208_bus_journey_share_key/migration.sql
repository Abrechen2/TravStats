/*
  Warnings:

  - A unique constraint covering the columns `[user_id,share_key]` on the table `bus_journeys` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "bus_journeys" ADD COLUMN     "share_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bus_journeys_user_id_share_key_key" ON "bus_journeys"("user_id", "share_key");
