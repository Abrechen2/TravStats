-- CreateTable
CREATE TABLE "entry_photo_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "flight_id" TEXT,
    "lodging_stay_id" TEXT,
    "rail_journey_id" TEXT,
    "bus_journey_id" TEXT,
    "ferry_journey_id" TEXT,
    "rental_booking_id" TEXT,
    "cruise_stop_id" TEXT,
    "trip_stop_id" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'immich',
    "asset_id" TEXT NOT NULL,
    "provenance" TEXT NOT NULL DEFAULT 'manual',
    "refused" BOOLEAN NOT NULL DEFAULT false,
    "mimetype" TEXT NOT NULL DEFAULT 'image/jpeg',
    "taken_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entry_photo_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "entry_photo_links_user_id_idx" ON "entry_photo_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_links_flight_id_provider_asset_id_key" ON "entry_photo_links"("flight_id", "provider", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_links_lodging_stay_id_provider_asset_id_key" ON "entry_photo_links"("lodging_stay_id", "provider", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_links_rail_journey_id_provider_asset_id_key" ON "entry_photo_links"("rail_journey_id", "provider", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_links_bus_journey_id_provider_asset_id_key" ON "entry_photo_links"("bus_journey_id", "provider", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_links_ferry_journey_id_provider_asset_id_key" ON "entry_photo_links"("ferry_journey_id", "provider", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_links_rental_booking_id_provider_asset_id_key" ON "entry_photo_links"("rental_booking_id", "provider", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_links_cruise_stop_id_provider_asset_id_key" ON "entry_photo_links"("cruise_stop_id", "provider", "asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "entry_photo_links_trip_stop_id_provider_asset_id_key" ON "entry_photo_links"("trip_stop_id", "provider", "asset_id");

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_lodging_stay_id_fkey" FOREIGN KEY ("lodging_stay_id") REFERENCES "lodging_stays"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_rail_journey_id_fkey" FOREIGN KEY ("rail_journey_id") REFERENCES "rail_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_bus_journey_id_fkey" FOREIGN KEY ("bus_journey_id") REFERENCES "bus_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_ferry_journey_id_fkey" FOREIGN KEY ("ferry_journey_id") REFERENCES "ferry_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_rental_booking_id_fkey" FOREIGN KEY ("rental_booking_id") REFERENCES "rental_bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_cruise_stop_id_fkey" FOREIGN KEY ("cruise_stop_id") REFERENCES "cruise_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_trip_stop_id_fkey" FOREIGN KEY ("trip_stop_id") REFERENCES "trip_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Exactly one entry per link (a row with none would belong to nobody, one with
-- two would be deleted by either).
ALTER TABLE "entry_photo_links" ADD CONSTRAINT "entry_photo_links_one_entry" CHECK (
  (("flight_id" IS NOT NULL)::int + ("lodging_stay_id" IS NOT NULL)::int + ("rail_journey_id" IS NOT NULL)::int
   + ("bus_journey_id" IS NOT NULL)::int + ("ferry_journey_id" IS NOT NULL)::int + ("rental_booking_id" IS NOT NULL)::int
   + ("cruise_stop_id" IS NOT NULL)::int + ("trip_stop_id" IS NOT NULL)::int) = 1
);
