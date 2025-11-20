-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flights" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "airline" TEXT NOT NULL,
    "flight_number" TEXT NOT NULL,
    "callsign" TEXT,
    "aircraft" TEXT,
    "dep_icao" TEXT,
    "dep_iata" TEXT,
    "dep_name" TEXT,
    "dep_lat" DOUBLE PRECISION NOT NULL,
    "dep_lon" DOUBLE PRECISION NOT NULL,
    "arr_icao" TEXT,
    "arr_iata" TEXT,
    "arr_name" TEXT,
    "arr_lat" DOUBLE PRECISION NOT NULL,
    "arr_lon" DOUBLE PRECISION NOT NULL,
    "departure_time" TIMESTAMP(3) NOT NULL,
    "arrival_time" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE INDEX "flights_user_id_idx" ON "flights"("user_id");

-- CreateIndex
CREATE INDEX "flights_departure_time_idx" ON "flights"("departure_time");

-- CreateIndex
CREATE INDEX "flights_status_idx" ON "flights"("status");

-- CreateIndex
CREATE INDEX "flights_airline_idx" ON "flights"("airline");

-- AddForeignKey
ALTER TABLE "flights" ADD CONSTRAINT "flights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
