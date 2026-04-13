-- AlterTable
ALTER TABLE "flights" ADD COLUMN "next_api_check_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "flights_next_api_check_at_idx" ON "flights"("next_api_check_at");
