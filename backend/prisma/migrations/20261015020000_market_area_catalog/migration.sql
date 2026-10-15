ALTER TABLE "dawarich_stay_scans"
  ADD COLUMN "market_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "market_result" JSONB;
CREATE TABLE "market_catalog_tiles" (
  "key" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "market_catalog_tiles_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "market_catalog_tiles_fetched_at_idx" ON "market_catalog_tiles"("fetched_at");
CREATE TABLE "market_catalog_state" (
  "id" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "bytes" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMP(3),
  "backoff_until" TIMESTAMP(3),
  CONSTRAINT "market_catalog_state_pkey" PRIMARY KEY ("id")
);
