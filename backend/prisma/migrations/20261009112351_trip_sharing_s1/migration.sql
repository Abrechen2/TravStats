/*
  Warnings:

  - A unique constraint covering the columns `[user_id,linked_user_id]` on the table `companions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[user_id,share_key]` on the table `cruises` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[user_id,share_key]` on the table `flights` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[user_id,share_key]` on the table `lodging_stays` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[user_id,share_key]` on the table `rail_journeys` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[user_id,share_key]` on the table `rental_bookings` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[trip_id,share_key]` on the table `trip_stops` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "companions" ADD COLUMN     "linked_user_id" TEXT;

-- AlterTable
ALTER TABLE "cruises" ADD COLUMN     "share_key" TEXT;

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "share_key" TEXT;

-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "share_key" TEXT;

-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "share_key" TEXT;

-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "share_key" TEXT;

-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "share_key" TEXT;

-- AlterTable
ALTER TABLE "trips" ADD COLUMN     "share_group_id" TEXT;

-- CreateTable
CREATE TABLE "share_consents" (
    "id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "share_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_share_groups" (
    "id" TEXT NOT NULL,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_share_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_notices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "group_id" TEXT,
    "actor_id" TEXT,
    "kind" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_key" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),
    "undone_at" TIMESTAMP(3),

    CONSTRAINT "share_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "share_consents_target_id_status_idx" ON "share_consents"("target_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "share_consents_requester_id_target_id_key" ON "share_consents"("requester_id", "target_id");

-- CreateIndex
CREATE INDEX "trip_share_groups_created_by_id_idx" ON "trip_share_groups"("created_by_id");

-- CreateIndex
CREATE INDEX "share_notices_user_id_read_at_idx" ON "share_notices"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "share_notices_group_id_idx" ON "share_notices"("group_id");

-- CreateIndex
CREATE INDEX "share_notices_actor_id_idx" ON "share_notices"("actor_id");

-- CreateIndex
CREATE INDEX "companions_linked_user_id_idx" ON "companions"("linked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "companions_user_id_linked_user_id_key" ON "companions"("user_id", "linked_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "cruises_user_id_share_key_key" ON "cruises"("user_id", "share_key");

-- CreateIndex
CREATE UNIQUE INDEX "flights_user_id_share_key_key" ON "flights"("user_id", "share_key");

-- CreateIndex
CREATE UNIQUE INDEX "lodging_stays_user_id_share_key_key" ON "lodging_stays"("user_id", "share_key");

-- CreateIndex
CREATE UNIQUE INDEX "rail_journeys_user_id_share_key_key" ON "rail_journeys"("user_id", "share_key");

-- CreateIndex
CREATE UNIQUE INDEX "rental_bookings_user_id_share_key_key" ON "rental_bookings"("user_id", "share_key");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_trip_id_share_key_key" ON "trip_stops"("trip_id", "share_key");

-- CreateIndex
CREATE INDEX "trips_share_group_id_idx" ON "trips"("share_group_id");

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_share_group_id_fkey" FOREIGN KEY ("share_group_id") REFERENCES "trip_share_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "companions" ADD CONSTRAINT "companions_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_consents" ADD CONSTRAINT "share_consents_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_consents" ADD CONSTRAINT "share_consents_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_share_groups" ADD CONSTRAINT "trip_share_groups_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_notices" ADD CONSTRAINT "share_notices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_notices" ADD CONSTRAINT "share_notices_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_notices" ADD CONSTRAINT "share_notices_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "trip_share_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
