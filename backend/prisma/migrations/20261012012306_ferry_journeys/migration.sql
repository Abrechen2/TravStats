-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "ferry_journey_id" TEXT;

-- CreateTable
CREATE TABLE "ferry_journeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "operator" TEXT,
    "vessel_name" TEXT,
    "vehicle_type" TEXT,
    "vehicle_registration" TEXT,
    "vehicle_length_m" DOUBLE PRECISION,
    "vehicle_width_m" DOUBLE PRECISION,
    "vehicle_height_m" DOUBLE PRECISION,
    "passenger_count" INTEGER,
    "cabin_type" TEXT,
    "ticket_reference" TEXT,
    "dep_station_name" TEXT NOT NULL,
    "dep_address" TEXT,
    "dep_lat" DOUBLE PRECISION NOT NULL,
    "dep_lon" DOUBLE PRECISION NOT NULL,
    "dep_country" TEXT,
    "dep_timezone" TEXT,
    "arr_station_name" TEXT NOT NULL,
    "arr_address" TEXT,
    "arr_lat" DOUBLE PRECISION NOT NULL,
    "arr_lon" DOUBLE PRECISION NOT NULL,
    "arr_country" TEXT,
    "arr_timezone" TEXT,
    "departure_time" TIMESTAMP(3) NOT NULL,
    "arrival_time" TIMESTAMP(3),
    "dep_precision" TEXT,
    "arr_precision" TEXT,
    "distance_km" DOUBLE PRECISION,
    "distance_source" TEXT,
    "geometry" JSONB,
    "geometry_source" TEXT NOT NULL DEFAULT 'straight',
    "actual_departure_time" TIMESTAMP(3),
    "actual_arrival_time" TIMESTAMP(3),
    "fare_class" TEXT,
    "seat" TEXT,
    "booking_reference" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'EUR',
    "price_base" DOUBLE PRECISION,
    "fx_rate" DOUBLE PRECISION,
    "fx_rate_date" TIMESTAMP(3),
    "fx_base_currency" TEXT,
    "fx_source" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "delay_minutes" INTEGER,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trip_id" TEXT,
    "booking_id" TEXT,
    "external_ref" TEXT,
    "import_batch_id" TEXT,
    "share_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ferry_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ferry_journey_companions" (
    "ferry_journey_id" TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ferry_journey_companions_pkey" PRIMARY KEY ("ferry_journey_id","companion_id")
);

-- CreateIndex
CREATE INDEX "ferry_journeys_user_id_departure_time_idx" ON "ferry_journeys"("user_id", "departure_time");

-- CreateIndex
CREATE INDEX "ferry_journeys_status_idx" ON "ferry_journeys"("status");

-- CreateIndex
CREATE INDEX "ferry_journeys_trip_id_idx" ON "ferry_journeys"("trip_id");

-- CreateIndex
CREATE INDEX "ferry_journeys_booking_id_idx" ON "ferry_journeys"("booking_id");

-- CreateIndex
CREATE INDEX "ferry_journeys_import_batch_id_idx" ON "ferry_journeys"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "ferry_journeys_user_id_external_ref_key" ON "ferry_journeys"("user_id", "external_ref");

-- CreateIndex
CREATE UNIQUE INDEX "ferry_journeys_user_id_share_key_key" ON "ferry_journeys"("user_id", "share_key");

-- CreateIndex
CREATE INDEX "ferry_journey_companions_companion_id_idx" ON "ferry_journey_companions"("companion_id");

-- CreateIndex
CREATE INDEX "documents_ferry_journey_id_idx" ON "documents"("ferry_journey_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_ferry_journey_id_fkey" FOREIGN KEY ("ferry_journey_id") REFERENCES "ferry_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferry_journeys" ADD CONSTRAINT "ferry_journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferry_journeys" ADD CONSTRAINT "ferry_journeys_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferry_journeys" ADD CONSTRAINT "ferry_journeys_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferry_journeys" ADD CONSTRAINT "ferry_journeys_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferry_journey_companions" ADD CONSTRAINT "ferry_journey_companions_ferry_journey_id_fkey" FOREIGN KEY ("ferry_journey_id") REFERENCES "ferry_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ferry_journey_companions" ADD CONSTRAINT "ferry_journey_companions_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express CHECK constraints. Extend the existing single-owner rule,
-- covered by migration.ferryJourneys.test.ts, without changing existing ownership.
ALTER TABLE "documents" DROP CONSTRAINT "documents_single_owner_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "trip_expense_id", "ferry_journey_id") <= 1
);
