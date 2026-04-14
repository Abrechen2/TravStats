-- Add is_closed flag so permanently closed airports (e.g. Berlin Tegel TXL)
-- can live in the airport table and still be selected for historical flights.
ALTER TABLE "airports" ADD COLUMN "is_closed" BOOLEAN NOT NULL DEFAULT false;
