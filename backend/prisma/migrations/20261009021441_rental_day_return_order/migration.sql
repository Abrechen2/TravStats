-- A day-only return is stored at its day's start and stands for the whole
-- local day (review I1): a return recorded only as the pickup's own day is
-- valid, though its stored instant precedes a timed pickup. The application
-- decides the exact order (`returnCertainlyBeforePickup`, rentalWrite.ts);
-- this CHECK stays the backstop against a return that cannot be right. A local
-- day lasts at most 25 hours (a clock change), so a day-only return is held
-- to its stored start plus 26 hours — never stricter than the application.
ALTER TABLE "rental_bookings" DROP CONSTRAINT "rental_bookings_return_after_pickup_check";
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_return_after_pickup_check" CHECK (
  "return_time" >= "pickup_time"
  OR ("return_precision" = 'day' AND "return_time" + INTERVAL '26 hours' > "pickup_time")
);
