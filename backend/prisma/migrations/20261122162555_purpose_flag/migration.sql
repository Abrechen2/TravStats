-- AlterTable
ALTER TABLE "bus_journeys" ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "cruises" ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "ferry_journeys" ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "place_visits" ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "rail_journeys" ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "purpose" TEXT;

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "purpose_visibility" JSONB;

-- A purpose is one of two words or unknown (spec 2026-11-22-private-business-purpose).
ALTER TABLE "place_visits" ADD CONSTRAINT "place_visits_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
ALTER TABLE "flights" ADD CONSTRAINT "flights_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
ALTER TABLE "rail_journeys" ADD CONSTRAINT "rail_journeys_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
ALTER TABLE "bus_journeys" ADD CONSTRAINT "bus_journeys_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
ALTER TABLE "ferry_journeys" ADD CONSTRAINT "ferry_journeys_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
ALTER TABLE "cruises" ADD CONSTRAINT "cruises_purpose_check" CHECK ("purpose" IS NULL OR "purpose" IN ('private', 'business'));
