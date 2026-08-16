-- AlterTable
ALTER TABLE "lodging_stays" ADD COLUMN     "date_precision" TEXT NOT NULL DEFAULT 'DAY',
ADD COLUMN     "nights" INTEGER,
ALTER COLUMN "check_in" DROP NOT NULL,
ALTER COLUMN "check_out" DROP NOT NULL;
