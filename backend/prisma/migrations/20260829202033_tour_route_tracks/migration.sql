-- CreateTable
CREATE TABLE "trip_route_tracks" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "geometry" JSONB NOT NULL,
    "point_count" INTEGER NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_route_tracks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_route_tracks_route_id_idx" ON "trip_route_tracks"("route_id");

-- AddForeignKey
ALTER TABLE "trip_route_tracks" ADD CONSTRAINT "trip_route_tracks_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "trip_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
