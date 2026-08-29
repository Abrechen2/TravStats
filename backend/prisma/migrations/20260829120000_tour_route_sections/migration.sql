-- AlterTable
ALTER TABLE "trip_stops" ADD COLUMN     "route_id" TEXT,
ADD COLUMN     "route_order_idx" INTEGER;

-- CreateTable
CREATE TABLE "trip_routes" (
    "id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "order_idx" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT,
    "notes" TEXT,
    "start_odometer_km" INTEGER,
    "end_odometer_km" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_route_legs" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "from_stop_id" TEXT NOT NULL,
    "to_stop_id" TEXT NOT NULL,
    "distance_km" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'medium',
    "waypoints" JSONB,
    "driving_minutes" INTEGER,
    "toll_cost" DOUBLE PRECISION,
    "currency" TEXT,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_route_legs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trip_routes_trip_id_idx" ON "trip_routes"("trip_id");

-- CreateIndex
CREATE INDEX "trip_route_legs_route_id_idx" ON "trip_route_legs"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_route_legs_route_id_from_stop_id_to_stop_id_key" ON "trip_route_legs"("route_id", "from_stop_id", "to_stop_id");

-- CreateIndex
CREATE INDEX "trip_stops_route_id_idx" ON "trip_stops"("route_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_route_id_route_order_idx_key" ON "trip_stops"("route_id", "route_order_idx");

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "trip_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_routes" ADD CONSTRAINT "trip_routes_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_route_legs" ADD CONSTRAINT "trip_route_legs_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "trip_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_route_legs" ADD CONSTRAINT "trip_route_legs_from_stop_id_fkey" FOREIGN KEY ("from_stop_id") REFERENCES "trip_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_route_legs" ADD CONSTRAINT "trip_route_legs_to_stop_id_fkey" FOREIGN KEY ("to_stop_id") REFERENCES "trip_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

