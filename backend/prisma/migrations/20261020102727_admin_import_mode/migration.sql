-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "import_mode_until" TIMESTAMP(3),
ADD COLUMN     "import_mode_user_id" TEXT;
