-- AlterTable
ALTER TABLE "trip_routes" ADD COLUMN     "purpose" TEXT;

-- A purpose is one of two words or unknown (spec 2026-11-22-private-business-purpose).
ALTER TABLE "trip_routes" ADD CONSTRAINT "trip_routes_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
