-- AlterTable: add AeroDataBox extended fields to flights (v1.5 importers)
-- Additive nullable — zero-downtime, rollback-safe (1.4 ignores unknown columns).
ALTER TABLE "flights" ADD COLUMN "runway_departure_time" TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN "runway_arrival_time" TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN "is_cargo" BOOLEAN;
ALTER TABLE "flights" ADD COLUMN "aerodatabox_last_updated_utc" TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN "aerodatabox_quality_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "flights" ADD COLUMN "baggage_belt" TEXT;
ALTER TABLE "flights" ADD COLUMN "check_in_desk" TEXT;

-- AlterTable: add AeroDataBox airport metadata fields to airports (v1.5 importers)
ALTER TABLE "airports" ADD COLUMN "short_name" TEXT;
ALTER TABLE "airports" ADD COLUMN "municipality_name" TEXT;
