-- CreateTable
CREATE TABLE "companions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "search_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flight_companions" (
    "flight_id" TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "flight_companions_pkey" PRIMARY KEY ("flight_id","companion_id")
);

-- CreateTable
CREATE TABLE "trip_companions" (
    "trip_id" TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "trip_companions_pkey" PRIMARY KEY ("trip_id","companion_id")
);

-- CreateTable
CREATE TABLE "cruise_companions" (
    "cruise_id" TEXT NOT NULL,
    "companion_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "cruise_companions_pkey" PRIMARY KEY ("cruise_id","companion_id")
);

-- CreateIndex
CREATE INDEX "companions_user_id_search_name_idx" ON "companions"("user_id", "search_name");

-- CreateIndex
CREATE UNIQUE INDEX "companions_user_id_canonical_name_key" ON "companions"("user_id", "canonical_name");

-- CreateIndex
CREATE INDEX "flight_companions_companion_id_idx" ON "flight_companions"("companion_id");

-- CreateIndex
CREATE INDEX "trip_companions_companion_id_idx" ON "trip_companions"("companion_id");

-- CreateIndex
CREATE INDEX "cruise_companions_companion_id_idx" ON "cruise_companions"("companion_id");

-- AddForeignKey
ALTER TABLE "companions" ADD CONSTRAINT "companions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_companions" ADD CONSTRAINT "flight_companions_flight_id_fkey" FOREIGN KEY ("flight_id") REFERENCES "flights"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flight_companions" ADD CONSTRAINT "flight_companions_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_companions" ADD CONSTRAINT "trip_companions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_companions" ADD CONSTRAINT "trip_companions_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruise_companions" ADD CONSTRAINT "cruise_companions_cruise_id_fkey" FOREIGN KEY ("cruise_id") REFERENCES "cruises"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cruise_companions" ADD CONSTRAINT "cruise_companions_companion_id_fkey" FOREIGN KEY ("companion_id") REFERENCES "companions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
