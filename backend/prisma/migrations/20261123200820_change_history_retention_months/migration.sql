-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "change_history_retention_months" INTEGER NOT NULL DEFAULT 12;
