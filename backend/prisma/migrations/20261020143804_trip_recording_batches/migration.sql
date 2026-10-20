-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "trip_recording_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "trip_recording_batches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "device_id" TEXT,
    "upload_id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "points" JSONB NOT NULL,
    "point_count" INTEGER NOT NULL,
    "skipped_outside_trip" INTEGER NOT NULL DEFAULT 0,
    "skipped_in_flight" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_recording_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_recording_batches_trip_id_started_at_idx" ON "trip_recording_batches"("trip_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "trip_recording_batches_user_id_upload_id_key" ON "trip_recording_batches"("user_id", "upload_id");

-- AddForeignKey
ALTER TABLE "trip_recording_batches" ADD CONSTRAINT "trip_recording_batches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_recording_batches" ADD CONSTRAINT "trip_recording_batches_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
