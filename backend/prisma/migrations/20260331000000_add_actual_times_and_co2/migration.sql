-- Phase 3: Add actual flight times, delay tracking and per-flight CO₂
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "actual_departure" TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "actual_arrival"   TIMESTAMP(3);
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "delay_minutes"    INTEGER;
ALTER TABLE "flights" ADD COLUMN IF NOT EXISTS "co2_kg"           DOUBLE PRECISION;
