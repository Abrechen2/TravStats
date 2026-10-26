-- Companion audit 2026-10-23: data that lived only on the phone gets a server copy.

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN "home_place" JSONB,
ADD COLUMN "passport_expiry" DATE;

-- CreateTable
CREATE TABLE "trip_packing_lists" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "last_mutation_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_packing_lists_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trip_packing_lists_trip_id_key" ON "trip_packing_lists"("trip_id");

-- CreateIndex
CREATE INDEX "trip_packing_lists_user_id_idx" ON "trip_packing_lists"("user_id");

-- AddForeignKey
ALTER TABLE "trip_packing_lists" ADD CONSTRAINT "trip_packing_lists_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
