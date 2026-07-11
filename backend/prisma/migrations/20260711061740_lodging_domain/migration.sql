-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "base_currency" TEXT DEFAULT 'EUR';

-- CreateTable
CREATE TABLE "lodgings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'hotel',
    "name" TEXT NOT NULL,
    "chain_id" INTEGER,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "stars" INTEGER,
    "amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "data_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lodgings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lodging_stays" (
    "id" TEXT NOT NULL,
    "lodging_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "booking_id" TEXT,
    "check_in" TIMESTAMP(3) NOT NULL,
    "check_out" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "room_number" TEXT,
    "room_category" TEXT,
    "board" TEXT,
    "price_per_night" DOUBLE PRECISION,
    "currency" TEXT DEFAULT 'EUR',
    "total_price" DOUBLE PRECISION,
    "total_price_base" DOUBLE PRECISION,
    "fx_rate" DOUBLE PRECISION,
    "fx_rate_date" TIMESTAMP(3),
    "fx_base_currency" TEXT,
    "is_award_stay" BOOLEAN NOT NULL DEFAULT false,
    "rating_room" DOUBLE PRECISION,
    "rating_breakfast" DOUBLE PRECISION,
    "rating_service" DOUBLE PRECISION,
    "rating_overall" DOUBLE PRECISION,
    "room_amenities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "booking_reference" TEXT,
    "membership_id" TEXT,
    "receipt_url" TEXT,
    "companions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "parser_template" TEXT,
    "parser_confidence" INTEGER,
    "data_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lodging_stays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lodging_chains" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "brand_color" TEXT,
    "loyalty_program" TEXT,
    "is_user_added" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lodging_chains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lodging_memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "program_name" TEXT NOT NULL,
    "chain_id" INTEGER,
    "membership_number" TEXT,
    "tier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lodging_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lodgings_user_id_idx" ON "lodgings"("user_id");

-- CreateIndex
CREATE INDEX "lodgings_user_id_type_idx" ON "lodgings"("user_id", "type");

-- CreateIndex
CREATE INDEX "lodging_stays_user_id_idx" ON "lodging_stays"("user_id");

-- CreateIndex
CREATE INDEX "lodging_stays_lodging_id_idx" ON "lodging_stays"("lodging_id");

-- CreateIndex
CREATE INDEX "lodging_stays_user_id_check_in_idx" ON "lodging_stays"("user_id", "check_in");

-- CreateIndex
CREATE INDEX "lodging_stays_status_idx" ON "lodging_stays"("status");

-- CreateIndex
CREATE INDEX "lodging_stays_trip_id_idx" ON "lodging_stays"("trip_id");

-- CreateIndex
CREATE INDEX "lodging_stays_booking_id_idx" ON "lodging_stays"("booking_id");

-- CreateIndex
CREATE INDEX "lodging_chains_name_idx" ON "lodging_chains"("name");

-- CreateIndex
CREATE INDEX "lodging_memberships_user_id_idx" ON "lodging_memberships"("user_id");

-- AddForeignKey
ALTER TABLE "lodgings" ADD CONSTRAINT "lodgings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodgings" ADD CONSTRAINT "lodgings_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "lodging_chains"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_lodging_id_fkey" FOREIGN KEY ("lodging_id") REFERENCES "lodgings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "lodging_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_memberships" ADD CONSTRAINT "lodging_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lodging_memberships" ADD CONSTRAINT "lodging_memberships_chain_id_fkey" FOREIGN KEY ("chain_id") REFERENCES "lodging_chains"("id") ON DELETE SET NULL ON UPDATE CASCADE;
