-- DropForeignKey
ALTER TABLE "trip_stops" DROP CONSTRAINT "trip_stops_route_id_fkey";

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "trip_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
