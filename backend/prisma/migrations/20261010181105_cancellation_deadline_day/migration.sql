-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "free_cancellation_on" DATE;

-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "free_cancellation_on" DATE;

-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "free_cancellation_on" DATE;

-- A deadline is an instant (with its zone) OR a day (zone optional), never both.
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_free_cancellation_zone_check";
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_free_cancellation_zone_check" CHECK (
  num_nonnulls("free_cancellation_until", "free_cancellation_on") <= 1
  AND ("free_cancellation_until" IS NULL OR "free_cancellation_zone" IS NOT NULL)
  AND ("free_cancellation_zone" IS NULL OR num_nonnulls("free_cancellation_until", "free_cancellation_on") = 1)
);

-- A deadline is an instant (with its zone) OR a day (zone optional), never both.
ALTER TABLE "lodging_stays" DROP CONSTRAINT "lodging_stays_free_cancellation_zone_check";
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_free_cancellation_zone_check" CHECK (
  num_nonnulls("free_cancellation_until", "free_cancellation_on") <= 1
  AND ("free_cancellation_until" IS NULL OR "free_cancellation_zone" IS NOT NULL)
  AND ("free_cancellation_zone" IS NULL OR num_nonnulls("free_cancellation_until", "free_cancellation_on") = 1)
);

-- A deadline is an instant (with its zone) OR a day (zone optional), never both.
ALTER TABLE "rental_bookings" DROP CONSTRAINT "rental_bookings_free_cancellation_zone_check";
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_free_cancellation_zone_check" CHECK (
  num_nonnulls("free_cancellation_until", "free_cancellation_on") <= 1
  AND ("free_cancellation_until" IS NULL OR "free_cancellation_zone" IS NOT NULL)
  AND ("free_cancellation_zone" IS NULL OR num_nonnulls("free_cancellation_until", "free_cancellation_on") = 1)
);
