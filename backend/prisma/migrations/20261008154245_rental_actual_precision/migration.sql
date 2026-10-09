-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "actual_pickup_precision" TEXT,
ADD COLUMN     "actual_return_precision" TEXT;

-- An actual time stored before these columns existed was read back to the
-- minute. A bare day sent then was stored at the station's midnight and shown
-- as 00:00; it cannot be told apart from a real midnight now, so every
-- existing value keeps the precision it has been shown with.
UPDATE "rental_bookings" SET "actual_pickup_precision" = 'minute' WHERE "actual_pickup_time" IS NOT NULL;
UPDATE "rental_bookings" SET "actual_return_precision" = 'minute' WHERE "actual_return_time" IS NOT NULL;
