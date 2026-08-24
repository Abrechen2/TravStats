-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "fx_base_currency" TEXT,
ADD COLUMN     "fx_rate" DOUBLE PRECISION,
ADD COLUMN     "fx_rate_date" TIMESTAMP(3),
ADD COLUMN     "fx_source" TEXT,
ADD COLUMN     "price_base" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "fx_base_currency" TEXT,
ADD COLUMN     "fx_rate" DOUBLE PRECISION,
ADD COLUMN     "fx_rate_date" TIMESTAMP(3),
ADD COLUMN     "fx_source" TEXT,
ADD COLUMN     "price_base" DOUBLE PRECISION;
