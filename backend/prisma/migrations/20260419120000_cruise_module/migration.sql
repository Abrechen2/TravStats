-- CreateTable
CREATE TABLE "ports" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "unlocode" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT,
    "region" TEXT,
    "is_user_added" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ships" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "imo" TEXT,
    "cruise_line" TEXT NOT NULL,
    "year_built" INTEGER,
    "gross_tonnage" INTEGER,
    "capacity" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "is_user_added" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cruises" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "ship_id" INTEGER,
    "ship_name_override" TEXT,
    "cruise_line" TEXT,
    "departure_port_id" INTEGER,
    "arrival_port_id" INTEGER,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "cabin_number" TEXT,
    "cabin_type" TEXT,
    "deck" INTEGER,
    "booking_reference" TEXT,
    "price" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'EUR',
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "companions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trip_id" TEXT,
    "booking_id" TEXT,
    "parser_template" TEXT,
    "parser_confidence" INTEGER,
    "data_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cruises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cruise_stops" (
    "id" TEXT NOT NULL,
    "cruise_id" TEXT NOT NULL,
    "port_id" INTEGER,
    "day_number" INTEGER NOT NULL,
    "is_at_sea" BOOLEAN NOT NULL DEFAULT false,
    "arrival_time" TIMESTAMP(3),
    "departure_time" TIMESTAMP(3),
    "excursion_note" TEXT,

    CONSTRAINT "cruise_stops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ports_unlocode_key" ON "ports"("unlocode");

-- CreateIndex
CREATE INDEX "ports_name_idx" ON "ports"("name");

-- CreateIndex
CREATE INDEX "ports_city_idx" ON "ports"("city");

-- CreateIndex
CREATE INDEX "ports_unlocode_idx" ON "ports"("unlocode");

-- CreateIndex
CREATE INDEX "ports_region_idx" ON "ports"("region");

-- CreateIndex
CREATE UNIQUE INDEX "ships_imo_key" ON "ships"("imo");

-- CreateIndex
CREATE INDEX "ships_name_idx" ON "ships"("name");

-- CreateIndex
CREATE INDEX "ships_cruise_line_idx" ON "ships"("cruise_line");

-- CreateIndex
CREATE INDEX "ships_imo_idx" ON "ships"("imo");

-- CreateIndex
CREATE INDEX "cruises_user_id_idx" ON "cruises"("user_id");

-- CreateIndex
CREATE INDEX "cruises_start_date_idx" ON "cruises"("start_date");

-- CreateIndex
CREATE INDEX "cruises_status_idx" ON "cruises"("status");

-- CreateIndex
CREATE INDEX "cruises_cruise_line_idx" ON "cruises"("cruise_line");

-- CreateIndex
CREATE INDEX "cruises_trip_id_idx" ON "cruises"("trip_id");

-- CreateIndex
CREATE INDEX "cruise_stops_cruise_id_idx" ON "cruise_stops"("cruise_id");

-- CreateIndex
CREATE INDEX "cruise_stops_port_id_idx" ON "cruise_stops"("port_id");

-- AddForeignKey
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_ship_id_fkey" FOREIGN KEY ("ship_id") REFERENCES "ships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_departure_port_id_fkey" FOREIGN KEY ("departure_port_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_arrival_port_id_fkey" FOREIGN KEY ("arrival_port_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruise_stops" ADD CONSTRAINT "cruise_stops_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruise_stops" ADD CONSTRAINT "cruise_stops_port_id_fkey" FOREIGN KEY ("port_id") REFERENCES "ports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
