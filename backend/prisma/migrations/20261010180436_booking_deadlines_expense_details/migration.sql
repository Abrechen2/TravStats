-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "free_cancellation_until" TIMESTAMP(3),
ADD COLUMN     "free_cancellation_zone" TEXT,
ADD COLUMN     "payment_due_on" DATE;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "trip_expense_id" TEXT;

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "online_check_in_opens_at" TIMESTAMP(3),
ADD COLUMN     "online_check_in_zone" TEXT;

-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "free_cancellation_until" TIMESTAMP(3),
ADD COLUMN     "free_cancellation_zone" TEXT,
ADD COLUMN     "payment_due_on" DATE;

-- AlterTable
ALTER TABLE "rental_bookings" ADD COLUMN     "free_cancellation_until" TIMESTAMP(3),
ADD COLUMN     "free_cancellation_zone" TEXT,
ADD COLUMN     "payment_due_on" DATE;

-- AlterTable
ALTER TABLE "trip_expenses" ADD COLUMN     "amount_base" DECIMAL(16,4),
ADD COLUMN     "fx_base_currency" TEXT,
ADD COLUMN     "fx_rate" DOUBLE PRECISION,
ADD COLUMN     "fx_rate_date" DATE,
ADD COLUMN     "fx_source" TEXT,
ADD COLUMN     "payer_companion_id" TEXT,
ADD COLUMN     "payer_name" TEXT;

-- CreateIndex
CREATE INDEX "documents_trip_expense_id_idx" ON "documents"("trip_expense_id");

-- CreateIndex
CREATE INDEX "trip_expenses_payer_companion_id_idx" ON "trip_expenses"("payer_companion_id");

-- AddForeignKey
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_payer_companion_id_fkey" FOREIGN KEY ("payer_companion_id") REFERENCES "companions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_trip_expense_id_fkey" FOREIGN KEY ("trip_expense_id") REFERENCES "trip_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added constraints (CHECKs are invisible to Prisma, so `check:drift`
-- neither sees nor needs them).

-- A deadline instant is stored with the zone it was stated in (ADR 0002 D1):
-- one without the other could not be shown on the right clock.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_free_cancellation_zone_check"
  CHECK (("free_cancellation_until" IS NULL) = ("free_cancellation_zone" IS NULL));
ALTER TABLE "lodging_stays" ADD CONSTRAINT "lodging_stays_free_cancellation_zone_check"
  CHECK (("free_cancellation_until" IS NULL) = ("free_cancellation_zone" IS NULL));
ALTER TABLE "rental_bookings" ADD CONSTRAINT "rental_bookings_free_cancellation_zone_check"
  CHECK (("free_cancellation_until" IS NULL) = ("free_cancellation_zone" IS NULL));
ALTER TABLE "flights" ADD CONSTRAINT "flights_online_check_in_zone_check"
  CHECK (("online_check_in_opens_at" IS NULL) = ("online_check_in_zone" IS NULL));

-- forgejo#150: the wider category list (`EXPENSE_KINDS` in shared/expenses.ts).
ALTER TABLE "trip_expenses" DROP CONSTRAINT "trip_expenses_kind";
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_kind"
  CHECK ("kind" IN ('ferry', 'toll', 'pitch', 'fuel', 'charging', 'parking', 'transport',
                    'food', 'groceries', 'activity', 'shopping', 'fees', 'other'));

-- The exchange-rate record is all five facts or none, from a known source.
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_fx_complete"
  CHECK (num_nonnulls("amount_base", "fx_rate", "fx_rate_date", "fx_base_currency", "fx_source") IN (0, 5));
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_fx_source"
  CHECK ("fx_source" IS NULL OR "fx_source" IN ('ecb', 'cdn', 'cached', 'manual'));
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_fx_rate_positive"
  CHECK ("fx_rate" IS NULL OR "fx_rate" > 0);

-- A ninth document owner: an expense's receipt
-- (services/documents/documentService.ts).
ALTER TABLE "documents" DROP CONSTRAINT "documents_single_owner_check";
ALTER TABLE "documents" ADD CONSTRAINT "documents_single_owner_check" CHECK (
  num_nonnulls("flight_id", "cruise_id", "lodging_stay_id", "trip_id", "place_visit_id", "rail_journey_id", "rental_booking_id", "bus_journey_id", "trip_expense_id") <= 1
);
