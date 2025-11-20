-- AlterTable
ALTER TABLE "flights" ALTER COLUMN "airline" DROP NOT NULL,
ALTER COLUMN "flight_number" DROP NOT NULL;

-- CreateTable
CREATE TABLE "airports" (
    "id" SERIAL NOT NULL,
    "iata" TEXT,
    "icao" TEXT,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "country" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "altitude" INTEGER,
    "timezone" TEXT,

    CONSTRAINT "airports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "airports_iata_key" ON "airports"("iata");

-- CreateIndex
CREATE UNIQUE INDEX "airports_icao_key" ON "airports"("icao");

-- CreateIndex
CREATE INDEX "airports_iata_idx" ON "airports"("iata");

-- CreateIndex
CREATE INDEX "airports_icao_idx" ON "airports"("icao");

-- CreateIndex
CREATE INDEX "airports_name_idx" ON "airports"("name");

-- CreateIndex
CREATE INDEX "airports_city_idx" ON "airports"("city");
