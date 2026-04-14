-- Allow the same IATA / ICAO to exist once for the active airport and once
-- for its closed predecessor (e.g. Munich Airport EDDM/MUC and the closed
-- Munich-Riem EDDM/MUC). The unique constraint moves from the bare code
-- columns to a composite (code, is_closed).
ALTER TABLE "airports" DROP CONSTRAINT IF EXISTS "airports_iata_key";
ALTER TABLE "airports" DROP CONSTRAINT IF EXISTS "airports_icao_key";

CREATE UNIQUE INDEX "airports_iata_is_closed_key" ON "airports"("iata", "is_closed");
CREATE UNIQUE INDEX "airports_icao_is_closed_key" ON "airports"("icao", "is_closed");
