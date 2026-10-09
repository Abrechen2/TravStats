-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "deposit_amount" DOUBLE PRECISION,
ADD COLUMN     "deposit_currency" TEXT,
ADD COLUMN     "deposit_paid_on" DATE,
ADD COLUMN     "deposit_returned_amount" DOUBLE PRECISION,
ADD COLUMN     "deposit_returned_on" DATE;
