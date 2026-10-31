-- DropIndex
DROP INDEX "flights_user_id_idx";

-- DropIndex
DROP INDEX "import_batches_user_id_idx";

-- DropIndex
DROP INDEX "lodgings_user_id_idx";

-- DropIndex
DROP INDEX "place_visits_user_id_idx";

-- DropIndex
DROP INDEX "places_user_id_idx";

-- DropIndex
DROP INDEX "trip_routes_user_id_idx";

-- DropIndex
DROP INDEX "trips_user_id_idx";

-- CreateIndex
CREATE INDEX "travtrack_points_user_id_seq_idx" ON "travtrack_points"("user_id", "seq");
