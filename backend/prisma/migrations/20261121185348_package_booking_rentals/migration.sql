-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "booking_id" TEXT;

-- CreateIndex
CREATE INDEX "rental_bookings_booking_id_idx" ON "rental_bookings"("booking_id");

-- AddForeignKey
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
