-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "bus_journey_id" TEXT;

-- CreateTable
CREATE TABLE "bus_journeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "operator" TEXT,
    "line_name" TEXT,
    "ride_kind" TEXT,
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bus_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bus_journey_companions" (
    "bus_journey_id" TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "bus_journey_companions_pkey" PRIMARY KEY ("bus_journey_id","companion_id")
);

-- CreateIndex
CREATE INDEX "bus_journeys_user_id_departure_time_idx" ON "bus_journeys"("user_id", "departure_time");

-- CreateIndex
CREATE INDEX "bus_journeys_status_idx" ON "bus_journeys"("status");

-- CreateIndex
CREATE INDEX "bus_journeys_trip_id_idx" ON "bus_journeys"("trip_id");

-- CreateIndex
CREATE INDEX "bus_journeys_booking_id_idx" ON "bus_journeys"("booking_id");

-- CreateIndex
CREATE INDEX "bus_journeys_import_batch_id_idx" ON "bus_journeys"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "bus_journeys_user_id_external_ref_key" ON "bus_journeys"("user_id", "external_ref");

-- CreateIndex
CREATE INDEX "bus_journey_companions_companion_id_idx" ON "bus_journey_companions"("companion_id");

-- CreateIndex
CREATE INDEX "documents_bus_journey_id_idx" ON "documents"("bus_journey_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_bus_journey_id_fkey" FOREIGN KEY ("bus_journey_id") REFERENCES "bus_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_journeys" ADD CONSTRAINT "bus_journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_journeys" ADD CONSTRAINT "bus_journeys_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_journeys" ADD CONSTRAINT "bus_journeys_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_journeys" ADD CONSTRAINT "bus_journeys_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_journey_companions" ADD CONSTRAINT "bus_journey_companions_bus_journey_id_fkey" FOREIGN KEY ("bus_journey_id") REFERENCES "bus_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bus_journey_companions" ADD CONSTRAINT "bus_journey_companions_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The single-owner rule gains the eighth owner. Prisma cannot express a CHECK;
-- the application enforces the same rule before it writes
-- (services/documents/documentService.ts).
ALTER TABLE "documents" DROP CONSTRAINT "documents_single_owner_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id") <= 1
);
