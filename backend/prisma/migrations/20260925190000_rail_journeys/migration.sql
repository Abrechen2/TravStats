-- CreateTable
CREATE TABLE "rail_journeys" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "operator" TEXT,
    "train_category" TEXT,
    "train_number" TEXT,
    "dep_station_name" TEXT NOT NULL,
    "dep_station_code" TEXT,
    "dep_lat" DOUBLE PRECISION NOT NULL,
    "dep_lon" DOUBLE PRECISION NOT NULL,
    "dep_country" TEXT,
    "dep_timezone" TEXT,
    "arr_station_name" TEXT NOT NULL,
    "arr_station_code" TEXT,
    "arr_lat" DOUBLE PRECISION NOT NULL,
    "arr_lon" DOUBLE PRECISION NOT NULL,
    "arr_country" TEXT,
    "arr_timezone" TEXT,
    "departure_time" TIMESTAMP(3) NOT NULL,
    "arrival_time" TIMESTAMP(3),
    "distance_km" DOUBLE PRECISION,
    "distance_source" TEXT,
    "geometry" JSONB,
    "geometry_source" TEXT NOT NULL DEFAULT 'straight',
    "actual_departure_time" TIMESTAMP(3),
    "actual_arrival_time" TIMESTAMP(3),
    "lookup_provider" TEXT,
    "lookup_ref" TEXT,
    "travel_class" TEXT,
    "coach" TEXT,
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

    CONSTRAINT "rail_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rail_journey_companions" (
    "rail_journey_id" TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "rail_journey_companions_pkey" PRIMARY KEY ("rail_journey_id","companion_id")
);

-- CreateIndex
CREATE INDEX "rail_journeys_user_id_departure_time_idx" ON "rail_journeys"("user_id", "departure_time");

-- CreateIndex
CREATE INDEX "rail_journeys_status_idx" ON "rail_journeys"("status");

-- CreateIndex
CREATE INDEX "rail_journeys_trip_id_idx" ON "rail_journeys"("trip_id");

-- CreateIndex
CREATE INDEX "rail_journeys_booking_id_idx" ON "rail_journeys"("booking_id");

-- CreateIndex
CREATE INDEX "rail_journeys_import_batch_id_idx" ON "rail_journeys"("import_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "rail_journeys_user_id_external_ref_key" ON "rail_journeys"("user_id", "external_ref");

-- CreateIndex
CREATE INDEX "rail_journey_companions_companion_id_idx" ON "rail_journey_companions"("companion_id");

-- AddForeignKey
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rail_journey_companions" ADD CONSTRAINT "rail_journey_companions_rail_journey_id_fkey" FOREIGN KEY ("rail_journey_id") REFERENCES "rail_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rail_journey_companions" ADD CONSTRAINT "rail_journey_companions_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
