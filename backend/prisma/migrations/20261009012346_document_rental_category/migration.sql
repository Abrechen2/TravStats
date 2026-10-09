-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "rental_category" TEXT;

-- A category labels a RENTAL's evidence and names one of five things; the
-- service refuses anything else, and the database holds the same line.
-- Existing documents keep NULL: uncategorised, nothing copied or moved.
ALTER TABLE "documents" ADD CONSTRAINT "documents_rental_category_check" CHECK (
  "rental_category" IS NULL
  OR ("rental_booking_id" IS NOT NULL
      AND "rental_category" IN ('pickup', 'return', 'damage', 'fuel', 'odometer'))
);
