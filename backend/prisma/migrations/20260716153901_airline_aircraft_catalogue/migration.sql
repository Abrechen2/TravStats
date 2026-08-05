-- CreateTable
CREATE TABLE "airlines" (
    "id" SERIAL NOT NULL,
    "iata" TEXT,
    "icao" TEXT,
    "name" TEXT NOT NULL,
    "callsign" TEXT,
    "country" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_user_added" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "airlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aircraft" (
    "id" SERIAL NOT NULL,
    "icao" TEXT,
    "name" TEXT NOT NULL,
    "is_user_added" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "aircraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "airlines_iata_key" ON "airlines"("iata");

-- CreateIndex
CREATE INDEX "airlines_name_idx" ON "airlines"("name");

-- CreateIndex
CREATE INDEX "airlines_icao_idx" ON "airlines"("icao");

-- CreateIndex
CREATE UNIQUE INDEX "aircraft_icao_key" ON "aircraft"("icao");

-- CreateIndex
CREATE INDEX "aircraft_name_idx" ON "aircraft"("name");
