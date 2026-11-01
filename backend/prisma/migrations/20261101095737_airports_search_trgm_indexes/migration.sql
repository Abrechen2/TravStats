-- CreateIndex
CREATE INDEX "airports_iata_trgm_idx" ON "airports" USING GIN ("iata" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "airports_icao_trgm_idx" ON "airports" USING GIN ("icao" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "airports_name_trgm_idx" ON "airports" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "airports_city_trgm_idx" ON "airports" USING GIN ("city" gin_trgm_ops);
