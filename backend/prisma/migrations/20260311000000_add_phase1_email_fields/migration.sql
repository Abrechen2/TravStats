-- AlterTable: Add Phase 1 email template parsing fields to flights
ALTER TABLE "flights" ADD COLUMN     "baggage_allowance" TEXT,
ADD COLUMN     "booking_class_letter" TEXT,
ADD COLUMN     "co_passengers" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "frequent_flyer_number" TEXT,
ADD COLUMN     "parser_confidence" INTEGER,
ADD COLUMN     "parser_template" TEXT;
