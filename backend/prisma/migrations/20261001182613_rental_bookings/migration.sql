-- Car rentals as a seventh domain (spec 2026-10-01-rental-domain-design, R1):
-- one row per rental contract, its companions, and the documents filed with it.

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "rental_booking_id" TEXT;

-- CreateTable
CREATE TABLE "rental_bookings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operated_by" TEXT,
    "broker" TEXT,
    "confirmation_number" TEXT,
    "broker_reference" TEXT,
    "agreement_number" TEXT,
    "invoice_number" TEXT,
    "pickup_station_name" TEXT NOT NULL,
    "pickup_address" TEXT,
    "pickup_airport_id" INTEGER,
    "pickup_lat" DOUBLE PRECISION NOT NULL,
    "pickup_lon" DOUBLE PRECISION NOT NULL,
    "pickup_country" TEXT,
    "pickup_timezone" TEXT NOT NULL,
    "return_station_name" TEXT NOT NULL,
    "return_address" TEXT,
    "return_airport_id" INTEGER,
    "return_lat" DOUBLE PRECISION NOT NULL,
    "return_lon" DOUBLE PRECISION NOT NULL,
    "return_country" TEXT,
    "return_timezone" TEXT NOT NULL,
    "pickup_time" TIMESTAMP(3) NOT NULL,
    "return_time" TIMESTAMP(3) NOT NULL,
    "pickup_precision" TEXT NOT NULL DEFAULT 'minute',
    "return_precision" TEXT NOT NULL DEFAULT 'minute',
    "actual_pickup_time" TIMESTAMP(3),
    "actual_return_time" TIMESTAMP(3),
    "vehicle_class" TEXT,
    "acriss_code" TEXT,
    "vehicle_example" TEXT,
    "vehicle_driven" TEXT,
    "odometer_out_km" INTEGER,
    "odometer_in_km" INTEGER,
    "distance_km" INTEGER,
    "distance_source" TEXT,
    "final_amount" DOUBLE PRECISION,
    "final_currency" TEXT,
    "final_amount_base" DOUBLE PRECISION,
    "final_fx_rate" DOUBLE PRECISION,
    "final_fx_rate_date" TIMESTAMP(3),
    "final_fx_base_currency" TEXT,
    "final_fx_source" TEXT,
    "final_amount_source" TEXT,
    "mileage_policy" TEXT,
    "mileage_cap_km" INTEGER,
    "fuel_policy" TEXT,
    "payment_timing" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "price_base" DOUBLE PRECISION,
    "fx_rate" DOUBLE PRECISION,
    "fx_rate_date" TIMESTAMP(3),
    "fx_base_currency" TEXT,
    "fx_source" TEXT,
    "inclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "arrival_flight_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_edited_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trip_id" TEXT,
    "route_id" TEXT,
    "external_ref" TEXT,
    "import_batch_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_booking_companions" (
    "rental_booking_id" TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "rental_booking_companions_pkey" PRIMARY KEY ("rental_booking_id","companion_id")
);

-- CreateIndex
CREATE INDEX "rental_bookings_user_id_pickup_time_idx" ON "rental_bookings"("user_id", "pickup_time");

-- CreateIndex
CREATE INDEX "rental_bookings_user_id_confirmation_number_idx" ON "rental_bookings"("user_id", "confirmation_number");

-- CreateIndex
CREATE INDEX "rental_bookings_status_idx" ON "rental_bookings"("status");

-- CreateIndex
CREATE INDEX "rental_bookings_trip_id_idx" ON "rental_bookings"("trip_id");

-- CreateIndex
CREATE INDEX "rental_bookings_route_id_idx" ON "rental_bookings"("route_id");

-- CreateIndex
CREATE INDEX "rental_bookings_import_batch_id_idx" ON "rental_bookings"("import_batch_id");

-- CreateIndex
CREATE INDEX "rental_bookings_pickup_airport_id_idx" ON "rental_bookings"("pickup_airport_id");

-- CreateIndex
CREATE INDEX "rental_bookings_return_airport_id_idx" ON "rental_bookings"("return_airport_id");

-- CreateIndex
CREATE UNIQUE INDEX "rental_bookings_user_id_external_ref_key" ON "rental_bookings"("user_id", "external_ref");

-- CreateIndex
CREATE INDEX "rental_booking_companions_companion_id_idx" ON "rental_booking_companions"("companion_id");

-- CreateIndex
CREATE INDEX "documents_rental_booking_id_idx" ON "documents"("rental_booking_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_rental_booking_id_fkey" FOREIGN KEY ("rental_booking_id") REFERENCES "rental_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "trip_routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_pickup_airport_id_fkey" FOREIGN KEY ("pickup_airport_id") REFERENCES "airports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_return_airport_id_fkey" FOREIGN KEY ("return_airport_id") REFERENCES "airports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_booking_companions" ADD CONSTRAINT "rental_booking_companions_rental_booking_id_fkey" FOREIGN KEY ("rental_booking_id") REFERENCES "rental_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_booking_companions" ADD CONSTRAINT "rental_booking_companions_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The single-owner rule gains the seventh owner. Prisma cannot express a CHECK;
-- the application enforces the same rule before it writes
-- (services/documents/documentService.ts).
ALTER TABLE "documents" DROP CONSTRAINT "documents_single_owner_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id") <= 1
);

-- The vocabulary of `LOYALTY_DOMAINS` (shared/domains.ts) widens by one: two
-- rental senders print provider loyalty numbers. Every existing row satisfies
-- the wider constraint.
ALTER TABLE "loyalty_memberships" DROP CONSTRAINT "loyalty_memberships_domain_check";
ALTER TABLE "loyalty_memberships" ADD CONSTRAINT "loyalty_memberships_domain_check"
  CHECK ("domain" IN ('flight', 'cruise', 'lodging', 'rail', 'rental'));

-- A booking's two instants keep their order whatever writes them (the route
-- refuses it first, with a field; this is the floor under every other writer).
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_return_after_pickup_check"
  CHECK ("return_time" >= "pickup_time");
