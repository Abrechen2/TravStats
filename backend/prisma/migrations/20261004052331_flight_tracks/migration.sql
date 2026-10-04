-- CreateTable
CREATE TABLE "flight_tracks" (
    "id" TEXT NOT NULL,
    "flight_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "device_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "geometry" JSONB NOT NULL,
    "segment_starts" JSONB NOT NULL,
    "cumulative_km" JSONB NOT NULL,
    "elevations" JSONB,
    "point_count" INTEGER NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flight_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "flight_tracks_flight_id_key" ON "flight_tracks"("flight_id");

-- AddForeignKey
ALTER TABLE "flight_tracks" ADD CONSTRAINT "flight_tracks_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;
