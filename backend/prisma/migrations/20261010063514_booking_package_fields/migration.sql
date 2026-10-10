-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "booked_on" DATE,
ADD COLUMN     "operator" TEXT,
ADD COLUMN     "travellers" INTEGER;
