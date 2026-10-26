-- AlterTable
ALTER TABLE "calendar_feeds" ADD COLUMN     "issued_by_api_token_id" TEXT;

-- AddForeignKey
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_issued_by_api_token_id_fkey" FOREIGN KEY ("issued_by_api_token_id") REFERENCES "api_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
