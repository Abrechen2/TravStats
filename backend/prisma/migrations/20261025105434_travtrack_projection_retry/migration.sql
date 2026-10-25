-- AlterTable
ALTER TABLE "travtrack_derivation_state" ADD COLUMN     "country_questions_due" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "failure_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "retry_after" TIMESTAMP(3);
