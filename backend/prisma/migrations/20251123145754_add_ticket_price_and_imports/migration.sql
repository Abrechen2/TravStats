-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('pending_review', 'accepted', 'rejected');

-- AlterTable
ALTER TABLE "flights" ADD COLUMN     "ticket_price" DOUBLE PRECISION,
ALTER COLUMN "category" SET DEFAULT 'private';

-- CreateTable
CREATE TABLE "imported_flights" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending_review',
    "subject" TEXT,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "raw" TEXT,
    "parsed" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imported_flights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "imported_flights_user_id_status_idx" ON "imported_flights"("user_id", "status");

-- AddForeignKey
ALTER TABLE "imported_flights" ADD CONSTRAINT "imported_flights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
