-- AlterTable
ALTER TABLE "trip_suggestion_decisions" ADD COLUMN     "member_content_keys" TEXT[] DEFAULT ARRAY[]::TEXT[];
